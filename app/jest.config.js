export default {
  preset: 'ts-jest/presets/default-esm',

  // .ts ファイルをESMとして扱うようJestに指示
  extensionsToTreatAsEsm: ['.ts'],

  // 新しい方式でts-jest設定を指定
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },

  // ESMでのモジュール解決を助けるための設定
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // テスト環境の指定
  testEnvironment: 'node',
};
