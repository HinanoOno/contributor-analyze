# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15.4.6 application bootstrapped with `create-next-app` using the App Router architecture. The project uses React 19.1.0, TypeScript, and Tailwind CSS v4 for styling.

## Common Commands

### Development
- `npm run dev` - Start development server with Turbopack (runs on http://localhost:3000)
- `npm run build` - Create production build
- `npm run start` - Start production server
- `npm run lint` - Run ESLint for code quality checks

### Working Directory
The Next.js application is located in the `app/` subdirectory, not the root. All npm commands should be run from `/workspaces/works/app/`.

## Architecture

### File Structure
- Uses Next.js App Router with the `app/` directory for routing and components
- `app/layout.tsx` - Root layout with Geist font configuration
- `app/page.tsx` - Home page component
- `app/globals.css` - Global styles including Tailwind CSS
- TypeScript configuration uses path mapping (`@/*` → `./`)

### Styling
- Tailwind CSS v4 with PostCSS integration
- Uses CSS custom properties for font variables (`--font-geist-sans`, `--font-geist-mono`)
- Responsive design with mobile-first approach using Tailwind breakpoints

### Fonts
- Geist and Geist Mono fonts loaded via `next/font/google`
- Configured as CSS variables for consistent typography