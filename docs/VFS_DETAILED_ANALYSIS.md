# VFS Support - Detailed File System Assumptions Analysis

This document provides a detailed analysis of all file system assumptions in the LaTeX Workshop codebase, organized by file and category.

## Table of Contents

1. [Node.js `fs` Module Usage](#1-nodejs-fs-module-usage)
2. [Path Module Assumptions](#2-path-module-assumptions)
3. [URI fsPath Usage](#3-uri-fspath-usage)
4. [External Process Spawning](#4-external-process-spawning)
5. [File Watcher Patterns](#5-file-watcher-patterns)
6. [VFS-Ready Components](#6-vfs-ready-components)

---

## 1. Node.js `fs` Module Usage

### 1.1 Extension Data Loading (Safe - Local Extension Files)

These usages are **safe** because they load bundled extension data files:

| File | Line | Usage | Notes |
|------|------|-------|-------|
| `src/completion/bibtex.ts` | 71-72 | `fs.readFileSync()` | Loading `data/bibtex-entries.json` |
| `src/completion/completer/atsuggestion.ts` | 44 | `fs.readFileSync()` | Loading `data/at-suggestions.json` |
| `src/completion/completer/macro.ts` | 28, 35-36 | `fs.readFileSync()` | Loading `data/macros.json`, `data/unimathsymbols.json` |
| `src/completion/completer/environment.ts` | 45 | `fs.readFileSync()` | Loading `data/environments.json` |
| `src/completion/completer/package.ts` | 122 | `fs.readFileSync()` | Loading `data/packagenames.json` |
| `src/completion/completer/class.ts` | 29 | `fs.readFileSync()` | Loading `data/classnames.json` |
| `src/utils/logger.ts` | 246 | `fs.readFileSync()` | Loading `package.json` for config |

### 1.2 Workspace File Operations (Needs VFS Migration)

These usages operate on workspace files and need VFS support:

| File | Line | Usage | VFS Impact | Priority |
|------|------|-------|------------|----------|
| `src/core/root.ts` | 321 | `fs.readFileSync(fileUri.fsPath)` | Root file detection in workspace | High |
| `src/lint/latex-linter/chktex.ts` | 157, 215 | `fs.readFileSync()` | Reading linter config and source | Medium |
| `src/completion/completer/package.ts` | 244-245 | `fs.readFileSync(clsPath)` | Reading .cls files | Medium |
| `src/completion/completer/reference.ts` | 268 | `fs.readFileSync(auxFile)` | Reading .aux files | Medium |
| `src/completion/completer/input.ts` | 78 | `fs.readdirSync(dir)` | Directory listing for completions | Medium |

### 1.3 File Existence Checks (Needs VFS Migration)

| File | Line | Usage | VFS Impact |
|------|------|-------|------------|
| `src/locate/synctex/worker.ts` | 241, 247 | `fs.existsSync()` | SyncTeX file resolution |
| `src/lint/latex-formatter/latexindent.ts` | 71 | `fs.existsSync(formatter)` | Formatter binary check |
| `src/lint/latex-linter/chktex.ts` | 87, 96, 126, 141 | `fs.existsSync()` | Config file checks |
| `src/lint/latex-linter/chktex.ts` | 276 | `fs.existsSync()` | Source file check |
| `src/lint/latex-linter/lacheck.ts` | 127 | `fs.existsSync()` | Source file check |
| `src/utils/convertfilename.ts` | 28 | `fs.existsSync(fpath)` | File existence |
| `src/completion/completer/package.ts` | 80, 90, 244 | `fs.existsSync()` | Package file checks |
| `src/language/definition.ts` | 109 | `fs.existsSync(absolutePath)` | Definition file check |
| `src/preview/hover/ongraphics.ts` | 102, 112, 118, 127 | `fs.existsSync()` | Graphics file checks |
| `src/parse/parser/parserutils.ts` | 72 | `fs.existsSync()` | Parser file check |
| `src/completion/completer/reference.ts` | 264 | `fs.existsSync(auxFile)` | Aux file check |

### 1.4 File Write Operations (Needs VFS Migration)

| File | Line | Usage | VFS Impact |
|------|------|-------|------------|
| `src/lint/latex-formatter/latexindent.ts` | 137 | `fs.writeFileSync(temporaryFile)` | Temp file for formatting |
| `src/lint/latex-formatter/latexindent.ts` | 141-142 | `fs.unlinkSync()` | Cleanup temp files |

### 1.5 Directory Operations (Needs VFS Migration)

| File | Line | Usage | VFS Impact |
|------|------|-------|------------|
| `src/extras/cleaner.ts` | 122 | `fs.statSync(realPath)` | File stat for cleaning |
| `src/extras/cleaner.ts` | 140 | `fs.readdirSync(folderRealPath)` | Directory listing |
| `src/lw.ts` | 53-54 | `fs.mkdirSync`, `fs.chmodSync` | Output directory creation |

---

## 2. Path Module Assumptions

### 2.1 Path Separator Assumptions

| File | Usage | Issue |
|------|-------|-------|
| `src/core/file.ts:63` | `path.sep` replacement | Normalizes to forward slashes |
| `src/utils/utils.ts:262` | `path.sep` replacement | Glob pattern normalization |
| `src/compile/recipe.ts:56` | `path.dirname(uri.fsPath)` | Assumes local path |

### 2.2 Absolute Path Resolution

| File | Usage | Issue |
|------|-------|-------|
| `src/core/file.ts:360` | `path.resolve()` for PDF path | Requires local filesystem |
| `src/core/file.ts:385` | `path.resolve()` for FLS path | Requires local filesystem |
| `src/compile/recipe.ts:109` | `path.resolve()` for output dir | Requires local filesystem |
| `src/utils/utils.ts:239` | `path.resolve()` for file resolution | File system assumption |

---

## 3. URI fsPath Usage

### 3.1 Critical fsPath Usage (Build System)

| File | Line | Usage Pattern | VFS Impact |
|------|------|---------------|------------|
| `src/compile/recipe.ts` | 56 | `path.dirname(lw.file.toUri(rootFile).fsPath)` | Working directory for build |
| `src/compile/recipe.ts` | 60 | `workspaceFolder.uri.fsPath` | Workspace folder path |
| `src/compile/build.ts` | 126 | `path.dirname(rootFile)` | Working directory |
| `src/compile/external.ts` | 22 | `vscode.Uri.file(pwd).fsPath` | External command cwd |

### 3.2 Root File and Cache fsPath Usage

| File | Line | Usage Pattern | VFS Impact |
|------|------|---------------|------------|
| `src/core/root.ts` | 27 | `uri.fsPath !== root.file.path` | Root file comparison |
| `src/core/root.ts` | 316-321 | `fileUri.fsPath` | Root file detection |
| `src/core/cache.ts` | 50-58 | `uri.fsPath` | Cache key |

### 3.3 Watcher fsPath Usage

| File | Line | Usage Pattern | VFS Impact |
|------|------|---------------|------------|
| `src/core/watcher.ts` | 101-102 | `path.dirname(uri.fsPath)`, `path.basename(uri.fsPath)` | File watching |
| `src/core/watcher.ts` | 203-204 | Same pattern | Bib file watching |
| `src/core/watcher.ts` | 258-259 | Same pattern | PDF file watching |
| `src/core/watcher.ts` | 281, 291 | Same pattern | Watcher management |

### 3.4 Tool Integration fsPath Usage

| File | Line | Usage Pattern | VFS Impact |
|------|------|---------------|------------|
| `src/locate/synctex.ts` | 327 | `path.basename(pdfUri.fsPath)` | SyncTeX PDF path |
| `src/locate/synctex.ts` | 341 | `path.dirname(pdfUri.fsPath)` | SyncTeX cwd |
| `src/lint/latex-formatter/tex-fmt.ts` | 21 | `path.dirname(document.uri.fsPath)` | Formatter cwd |
| `src/lint/latex-linter/chktex.ts` | 94 | `path.resolve(workspaceFolder.uri.fsPath)` | Linter config |
| `src/preview/viewer.ts` | 219 | `path.dirname(pdfUri.fsPath)` | Viewer cwd |

---

## 4. External Process Spawning

### 4.1 LaTeX Compilation

| File | Function | External Tool | Path Requirements |
|------|----------|---------------|-------------------|
| `src/compile/build.ts` | `spawnProcess()` | pdflatex, latexmk, xelatex, etc. | cwd must be local |
| `src/compile/external.ts` | `build()` | User-defined | cwd must be local |

### 4.2 SyncTeX

| File | Function | External Tool | Path Requirements |
|------|----------|---------------|-------------------|
| `src/locate/synctex.ts` | `toPDF()`, `toTeX()` | synctex | PDF and TeX paths must be local |

### 4.3 Linting and Formatting

| File | Function | External Tool | Path Requirements |
|------|----------|---------------|-------------------|
| `src/lint/latex-linter/chktex.ts` | `lintRoot()`, `lintFile()` | chktex | Source file must be local |
| `src/lint/latex-linter/lacheck.ts` | `lintRootFileIfEnabled()` | lacheck | Source file must be local |
| `src/lint/latex-formatter/latexindent.ts` | `format()` | latexindent | Source file must be local |
| `src/lint/latex-formatter/tex-fmt.ts` | `format()` | tex-fmt | stdin, cwd must be local |

### 4.4 Utility Commands

| File | Function | External Tool | Path Requirements |
|------|----------|---------------|-------------------|
| `src/core/file.ts` | `kpsewhich()` | kpsewhich | cwd should be local |
| `src/extras/counter.ts` | `count()` | texcount | Source file must be local |
| `src/preview/viewer.ts` | `viewExternal()` | User PDF viewer | PDF path must be local |

---

## 5. File Watcher Patterns

### 5.1 Source File Watcher (`src/core/watcher.ts`)

```typescript
// Current implementation uses native file watchers
vscode.workspace.createFileSystemWatcher(pattern)
```

**VFS Considerations:**
- VS Code's `createFileSystemWatcher` may not support all VFS schemes
- Need fallback to polling for VFS files
- Consider using `vscode.workspace.onDidChangeTextDocument` for open files

### 5.2 PDF Watcher

```typescript
// Uses polling via setTimeout
setTimeout(() => checkPdfChange(pdfPath), delay)
```

**VFS Considerations:**
- PDF files would be generated locally (after VFS sync)
- May need to copy PDF back to VFS after generation

---

## 6. VFS-Ready Components

### 6.1 Already VFS-Compatible

| Component | File | Method | Notes |
|-----------|------|--------|-------|
| File Read | `src/core/file.ts` | `read()` | Uses `vscode.workspace.fs.readFile` |
| File Exists | `src/core/file.ts` | `exists()` | Uses `vscode.workspace.fs.stat` |
| URI Conversion | `src/core/file.ts` | `toUri()` | Scheme detection |
| Config Access | Various | `vscode.workspace.getConfiguration()` | URI-aware |

### 6.2 Partially VFS-Compatible

| Component | File | Issue |
|-----------|------|-------|
| Root Detection | `src/core/root.ts` | Uses fsPath for comparisons |
| Cache | `src/core/cache.ts` | Uses fsPath as keys |
| Watcher | `src/core/watcher.ts` | Uses native file watchers |

---

## Summary Statistics

| Category | Count | VFS Blocking |
|----------|-------|--------------|
| Files with `fs` import | 23 | Most need review |
| `fs.readFileSync` calls | 15 | 7 need migration |
| `fs.existsSync` calls | 18 | All need migration |
| `fs.writeFileSync` calls | 1 | Needs migration |
| `.fsPath` usage points | 40+ | All need review |
| External process spawns | 8 modules | All need local paths |

---

## Recommended Migration Priority

### Priority 1: Core Build System
1. `src/compile/recipe.ts` - VFS sync integration
2. `src/compile/build.ts` - VFS root file handling
3. `src/core/file.ts` - Add `isVirtual()`, `syncToLocal()`

### Priority 2: Root Detection and Caching
4. `src/core/root.ts` - URI-based root detection
5. `src/core/cache.ts` - URI-based caching

### Priority 3: Tool Integration
6. `src/locate/synctex.ts` - Handle synced PDFs
7. `src/lint/latex-linter/chktex.ts` - VFS source files
8. `src/lint/latex-formatter/latexindent.ts` - VFS source files

### Priority 4: Completions and Language Features
9. `src/completion/completer/input.ts` - VFS directory listing
10. `src/language/definition.ts` - VFS definition resolution
