/**
 * バッチ処理とリトライ機能の共通ライブラリ
 */

export interface BatchProcessorOptions {
  batchSize?: number;
  batchDelayMs?: number;
  itemTimeoutMs?: number;
  batchTimeoutMs?: number;
  maxRetries?: number;
  baseRetryDelay?: number;
  concurrentBatches?: number;
}

export interface ProcessorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// レート制限/リトライ用ユーティリティ（共通化）
let last429CooldownUntil = 0;

function parseRetryDelayMs(msg: string | undefined): number | null {
  if (!msg) return null;
  const match = msg.match(/retryDelay"?:"?(\d+)(s|sec)/i);
  if (match) {
    const sec = parseInt(match[1], 10);
    if (!isNaN(sec)) return sec * 1000;
  }
  return null;
}

async function ensureCooldown() {
  const now = Date.now();
  if (now < last429CooldownUntil) {
    const wait = last429CooldownUntil - now;
    console.log(`⏳ Global cooldown active: waiting ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 4,
  baseDelay: number = 1200,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await ensureCooldown();
      return await operation();
    } catch (e: any) {
      const msg = e?.message || '';
      const status = e?.status || (typeof msg === 'string' && msg.match(/\[(\d{3}) /)?.[1]);
      const isRate = status == 429 || msg.includes('[429');
      const isServer = [500, 503].includes(Number(status));
      const isLast = i === maxRetries - 1;

      if (isRate) {
        const delay = (parseRetryDelayMs(msg) || 30_000) + Math.floor(Math.random() * 1500);
        last429CooldownUntil = Date.now() + delay;
        if (isLast) throw e;
        console.warn(`🚦 Rate limit (attempt ${i + 1}/${maxRetries}) wait ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!isServer || isLast) throw e;
      const delay = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 400);
      console.log(`⚠️ Error (attempt ${i + 1}/${maxRetries}) retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * バッチ処理クラス
 */
export class BatchProcessor<TInput, TOutput> {
  private options: Required<BatchProcessorOptions>;

  constructor(options: BatchProcessorOptions = {}) {
    this.options = {
      batchSize: options.batchSize ?? 2,
      batchDelayMs: options.batchDelayMs ?? 3000,
      itemTimeoutMs: options.itemTimeoutMs ?? 3 * 60 * 1000, // 3分
      batchTimeoutMs: options.batchTimeoutMs ?? 5 * 60 * 1000, // 5分
      maxRetries: options.maxRetries ?? 4,
      baseRetryDelay: options.baseRetryDelay ?? 1200,
      concurrentBatches: options.concurrentBatches ?? 1,
    };
  }

  /**
   * 単一アイテムをタイムアウト付きで処理
   */
  private async processItemWithTimeout(
    item: TInput,
    processor: (item: TInput) => Promise<TOutput | null>,
    itemName: string,
  ): Promise<TOutput | null> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${itemName} processing timeout`)), this.options.itemTimeoutMs),
    );

    const processPromise = async (): Promise<TOutput | null> => {
      try {
        return await retryWithBackoff(() => processor(item), this.options.maxRetries, this.options.baseRetryDelay);
      } catch (error) {
        console.error(`❌ Error processing ${itemName}:`, error);
        return null;
      }
    };

    try {
      return await Promise.race([processPromise(), timeoutPromise]);
    } catch (error) {
      console.error(`❌ ${itemName} processing failed or timed out:`, error);
      return null;
    }
  }

  /**
   * バッチ処理メイン関数
   */
  async processBatches(
    items: TInput[],
    processor: (item: TInput) => Promise<TOutput | null>,
    getItemName: (item: TInput) => string,
    processName: string = 'items',
  ): Promise<TOutput[]> {
    console.log(`🚀 Starting batch processing for ${items.length} ${processName}...`);

    if (this.options.concurrentBatches > 1) {
      return this.processConcurrentBatches(items, processor, getItemName, processName);
    }

    const allResults: TOutput[] = [];
    const totalBatches = Math.ceil(items.length / this.options.batchSize);

    for (let i = 0; i < items.length; i += this.options.batchSize) {
      const batch = items.slice(i, i + this.options.batchSize);
      const batchNumber = Math.floor(i / this.options.batchSize) + 1;

      const batchItemNames = batch.map(getItemName);
      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches}: ${batchItemNames.join(', ')}`);

      try {
        // バッチごとにタイムアウトを設定
        const batchPromise = Promise.allSettled(
          batch.map((item) => this.processItemWithTimeout(item, processor, getItemName(item))),
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Batch ${batchNumber} timeout`)), this.options.batchTimeoutMs),
        );

        const batchResults = (await Promise.race([
          batchPromise,
          timeoutPromise,
        ])) as PromiseSettledResult<TOutput | null>[];

        // 成功した結果のみを抽出
        const successfulResults = batchResults
          .filter(
            (result): result is PromiseFulfilledResult<TOutput> =>
              result.status === 'fulfilled' && result.value !== null,
          )
          .map((result) => result.value);

        allResults.push(...successfulResults);

        const successCount = successfulResults.length;
        console.log(`✅ Batch ${batchNumber}/${totalBatches} completed (${successCount}/${batch.length} successful)`);

        // 進捗報告
        console.log(`📊 Overall progress: ${allResults.length}/${items.length} ${processName} processed successfully`);
      } catch (error) {
        console.error(`❌ Batch ${batchNumber} failed:`, error);
        // バッチが失敗しても処理を継続
      }

      // バッチ間の待機（レート制限対策）
      if (i + this.options.batchSize < items.length) {
        console.log(`⏱️ Waiting ${this.options.batchDelayMs}ms between batches...`);
        await new Promise((resolve) => setTimeout(resolve, this.options.batchDelayMs));
      }
    }

    console.log(
      `✅ Batch processing completed: ${allResults.length}/${items.length} ${processName} processed successfully`,
    );
    return allResults;
  }

  /**
   * 複数バッチを並行実行する処理
   */
  private async processConcurrentBatches(
    items: TInput[],
    processor: (item: TInput) => Promise<TOutput | null>,
    getItemName: (item: TInput) => string,
    processName: string,
  ): Promise<TOutput[]> {
    const allResults: TOutput[] = [];

    // 全バッチを作成
    const batches = [];
    for (let i = 0; i < items.length; i += this.options.batchSize) {
      batches.push(items.slice(i, i + this.options.batchSize));
    }

    console.log(`Processing ${batches.length} batches with ${this.options.concurrentBatches} concurrent batches...`);

    // 複数バッチを並行実行
    for (let i = 0; i < batches.length; i += this.options.concurrentBatches) {
      const concurrentBatches = batches.slice(i, i + this.options.concurrentBatches);

      const batchPromises = concurrentBatches.map(async (batchItems, batchIndex) => {
        const actualBatchNumber = i + batchIndex + 1;
        console.log(
          `Processing concurrent batch ${actualBatchNumber}/${batches.length} with ${batchItems.length} items...`,
        );

        try {
          const batchPromise = Promise.allSettled(
            batchItems.map((item) => this.processItemWithTimeout(item, processor, getItemName(item))),
          );

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Batch ${actualBatchNumber} timeout`)), this.options.batchTimeoutMs),
          );

          const batchResults = (await Promise.race([
            batchPromise,
            timeoutPromise,
          ])) as PromiseSettledResult<TOutput | null>[];

          // 成功した結果のみを抽出
          const successfulResults = batchResults
            .filter(
              (result): result is PromiseFulfilledResult<TOutput> =>
                result.status === 'fulfilled' && result.value !== null,
            )
            .map((result) => result.value);

          console.log(
            `✅ Concurrent batch ${actualBatchNumber}/${batches.length} completed (${successfulResults.length}/${batchItems.length} successful)`,
          );
          return successfulResults;
        } catch (batchError) {
          console.error(`❌ Concurrent batch ${actualBatchNumber} processing failed:`, batchError);
          return [];
        }
      });

      try {
        // 複数バッチを並列実行
        const concurrentResults = await Promise.all(batchPromises);
        // 結果をフラットに展開
        allResults.push(...concurrentResults.flat());
      } catch (concurrentError) {
        console.error(`❌ Concurrent batch processing failed:`, concurrentError);
      }

      // バッチ間の待機（レート制限対策）
      if (i + this.options.concurrentBatches < batches.length) {
        console.log(`⏱️ Waiting ${this.options.batchDelayMs}ms between concurrent batch groups...`);
        await new Promise((resolve) => setTimeout(resolve, this.options.batchDelayMs));
      }
    }

    console.log(
      `✅ Concurrent batch processing completed: ${allResults.length}/${items.length} ${processName} processed successfully`,
    );
    return allResults;
  }
}
