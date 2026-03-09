# VFS Integration Summary for LaTeX Workshop

This document summarizes the changes made to add full Virtual File System (VFS) support to the LaTeX Workshop VS Code extension.

## Overview

LaTeX Workshop previously had "limited" VFS support, meaning most build and compilation features were disabled when working with files from virtual file systems (e.g., `vfs://`, `vscode-remote://`, `memfs://`). The extension now fully supports VFS workspaces by syncing files to a local temp directory before compilation.

## Core Problem

External LaTeX tools (`pdflatex`, `latexmk`, `xelatex`, etc.) require **real filesystem paths** - they cannot read from VS Code's virtual file systems. The solution is to:
1. Detect when files are from a VFS
2. Sync them to a local temp directory
3. Run compilation tools on the synced files
4. Use the synced output paths for viewing PDFs

## Key Files Modified

### 1. `src/lw.ts` and `src/core/file.ts` - Unified Scheme Support
**Before:** Static array of allowed schemes
```typescript
FILE_URI_SCHEMES: ['file', 'vsls']
```

**After:** The `lw.file.isSupportedScheme()` function uses an inclusion-based approach that:
- Supports core schemes: `file`, `vsls`, `vscode-remote`, `vscode-vfs`
- Dynamically detects workspace folder schemes
- Allows configuration of additional schemes via `latex-workshop.vfs.additionalSchemes`

```typescript
function isSupportedScheme(scheme: string): boolean {
    const coreSchemes = ['file', 'vsls', 'vscode-remote', 'vscode-vfs']
    if (coreSchemes.includes(scheme)) { return true }
    if (vscode.workspace.workspaceFolders?.some(folder => folder.uri.scheme === scheme)) {
        return true
    }
    const additionalSchemes = configuration.get<string[]>('vfs.additionalSchemes', [])
    return additionalSchemes.includes(scheme)
}
```

**Why:** A single, inclusion-based approach ensures consistent behavior across all extension features. Dynamic detection of workspace folder schemes automatically supports any VFS provider.

### 2. `src/core/file.ts` - Path Normalization for VFS

**Problem:** Windows uses backslash (`\`) in paths, but VFS URIs use forward slash (`/`). Path matching failed:
```
filePath=\tex.tex, matchingFolder=undefined  // WRONG
```

**Fix:** Normalize path separators before comparing:
```typescript
function toUri(filePath: string): vscode.Uri {
    const normalizedPath = filePath?.split(path.sep).join('/')
    const matchingFolder = vscode.workspace.workspaceFolders?.filter(
        folder => normalizedPath?.startsWith(folder.uri.path)
    )[0]
    // ...
}
```

### 3. `src/core/root.ts` - VFS-Compatible File Reading

**Problem:** Root file detection used Node.js `fs.readFileSync()` which doesn't work with VFS:
```typescript
const content = fs.readFileSync(fileUri.fsPath).toString()  // Fails for VFS
```

**Fix:** Use VS Code's workspace FS API:
```typescript
const contentBytes = await vscode.workspace.fs.readFile(fileUri)
content = Buffer.from(contentBytes).toString()
```

### 4. `src/compile/recipe.ts` - VFS Sync During Build

The existing VFS sync infrastructure (`lw.vfsSync.syncProject()`) is invoked during build:
1. Detects if root file is virtual: `lw.file.isVirtual(rootUri)`
2. Syncs entire project to temp directory
3. Uses synced path for compilation: `effectiveRootFile = localPath`
4. Stores compiled PDF path: `lw.compile.compiledPDFPath = lw.file.getPdfPath(effectiveRootFile)`

### 5. `src/core/commands.ts` - VFS-Aware PDF Viewing

**Problem:** PDF viewer computed path from VFS root path, resulting in non-existent paths:
```
vfs:/tex.tex → c:\tex.pdf  // WRONG - doesn't exist
```

**Fix:** Use stored `compiledPDFPath` for VFS files:
```typescript
if (lw.file.isVirtual(rootUri) && lw.compile.compiledPDFPath) {
    pdfPath = lw.compile.compiledPDFPath  // Points to temp directory
} else {
    pdfPath = lw.file.getPdfPath(pickedRootFile)
}
```

### 6. `package.json` - Enable Commands in Virtual Workspaces

**Changes:**
- `virtualWorkspaces.supported`: `"limited"` → `true`
- Removed `"enablement": "!virtualWorkspace"` from commands:
  - `latex-workshop.build`
  - `latex-workshop.recipes`
  - `latex-workshop.kill`
  - `latex-workshop.clean`
  - `latex-workshop.viewExternal`
  - `latex-workshop.compilerlog`
- Removed `&& !virtualWorkspace` from keybinding `when` clauses
- Removed `&& !virtualWorkspace` from context menu and editor title bar `when` clauses

## VFS Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     VFS Workspace (vfs:/)                        │
│  ┌─────────────┐                                                │
│  │  tex.tex    │ ← User edits here                              │
│  │  main.bib   │                                                │
│  │  images/    │                                                │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
           │
           │ Build triggered (Ctrl+Alt+B)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              VFS Sync (lw.vfsSync.syncProject)                  │
│                                                                 │
│  1. Detect VFS: lw.file.isVirtual(rootUri) → true               │
│  2. Create temp dir: C:/Users/.../Temp/latex-workshop-vfs/hash/ │
│  3. Copy all files from VFS to temp                             │
│  4. Return synced paths                                         │
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Local Temp Directory                           │
│  C:/Users/james/AppData/Local/Temp/latex-workshop-vfs/6aeea38/  │
│  ┌─────────────┐                                                │
│  │  tex.tex    │ ← latexmk runs here                            │
│  │  main.bib   │                                                │
│  │  images/    │                                                │
│  │  tex.pdf    │ ← Output generated here                        │
│  │  tex.synctex│                                                │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
           │
           │ View PDF (Ctrl+Alt+V)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PDF Viewer                                   │
│                                                                 │
│  Uses lw.compile.compiledPDFPath which points to:               │
│  C:/Users/.../Temp/latex-workshop-vfs/6aeea38/tex.pdf           │
└─────────────────────────────────────────────────────────────────┘
```

## Important Limitations

1. **One-way sync:** Changes in VFS are synced to temp, but output (PDF) is NOT synced back to VFS
2. **Build required first:** PDF viewer only works after building (that's when `compiledPDFPath` is set)
3. **Temp directory cleanup:** Synced files remain in temp until VS Code is closed or cleanup is triggered

## Testing VFS Support

1. Open a VFS workspace (e.g., using a MemFS extension or remote workspace)
2. Create a `.tex` file with `\documentclass{article}` and content
3. Save the file
4. Build with Ctrl+Alt+B - should see "VFS project synced" in logs
5. View PDF with Ctrl+Alt+V - should open from temp directory

## Configuration

The VFS sync can be controlled via settings:
- `latex-workshop.vfs.sync.enabled`: Enable/disable VFS sync (default: `true`)
- `latex-workshop.vfs.additionalSchemes`: Additional URI schemes to treat as VFS

## Debug Logging

Key log messages to look for:
```
[VFS] Syncing project from VFS: vfs:/
[VFS] Project synced: vfs:/ -> C:/.../latex-workshop-vfs/hash (N files)
[Build][Recipe] Root file is from virtual filesystem: vfs
[Build][Recipe] VFS project synced, using local root file: C:/.../hash/tex.tex
```
