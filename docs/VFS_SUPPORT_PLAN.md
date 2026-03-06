# Virtual File System (VFS) Support Plan

This document outlines the analysis and implementation plan for adding VFS support to the LaTeX Workshop extension, enabling the generation of LaTeX documents from files that exist only in virtual file systems provided by VS Code extensions.

## Executive Summary

The extension needs to be refactored to use URI objects and respect the protocol of resources (e.g., `file:`, `vscode-remote:`, etc.) as contributed by VS Code extensions. Since external LaTeX tools (pdflatex, latexmk, etc.) require real filesystem paths, VFS files will need to be synchronized to local disk before document generation.

## Current State Analysis

### 1. Existing VFS Support

The extension already has **limited** VFS support:
- Package.json declares: `"virtualWorkspaces": { "supported": "limited" }`
- Supports `file://` and `vsls://` (VS Code Live Share) URI schemes
- Uses `vscode.workspace.fs` API for most file reading operations
- Key constant: `lw.constant.FILE_URI_SCHEMES = ['file', 'vsls']`

### 2. File System Abstraction Layer (`src/core/file.ts`)

**Already VFS-friendly:**
- `read(filePathOrUri)` - Uses `vscode.workspace.fs.readFile()`
- `exists(uri)` - Uses `vscode.workspace.fs.stat()`
- `toUri(filePath)` - Converts paths to URIs with scheme detection

**VFS-blocking:**
- `file.tmpDirPath` - Uses `tmp.dirSync()` to create local temp directory
- `kpsewhich()` - Calls external command that requires local filesystem

### 3. Files Using Node.js `fs` Module (23 files)

These files directly use Node.js filesystem APIs and need consideration for VFS support:

| File | Usage Type | VFS Impact |
|------|------------|------------|
| `src/lw.ts` | `mkdirSync`, `chmodSync` | Output directory creation |
| `src/core/root.ts` | `readFileSync` | Root file detection in workspace |
| `src/extras/cleaner.ts` | `statSync`, `readdirSync` | Cleaning build artifacts |
| `src/locate/synctex.ts` | `existsSync` | SyncTeX operations |
| `src/locate/synctex/worker.ts` | `existsSync` | SyncTeX worker |
| `src/lint/latex-formatter/latexindent.ts` | `existsSync`, `writeFileSync`, `unlinkSync` | Formatter |
| `src/lint/latex-linter/chktex.ts` | `existsSync`, `readFileSync` | Linter |
| `src/lint/latex-linter/lacheck.ts` | `existsSync` | Linter |
| `src/completion/bibtex.ts` | `readFileSync` | Loading bundled data |
| `src/completion/completer/*.ts` | `readFileSync`, `readdirSync` | Loading bundled data, completions |
| `src/language/definition.ts` | `existsSync` | Go-to definition |
| `src/preview/hover/ongraphics.ts` | `existsSync` | Graphics preview |
| `src/parse/parser/parserutils.ts` | `existsSync` | Parser utilities |
| `src/utils/convertfilename.ts` | `existsSync` | Filename conversion |
| `src/utils/pathnormalize.ts` | N/A | Path utilities |
| `src/utils/logger.ts` | `readFileSync` | Loading package.json |

### 4. External Process Dependencies

The following components spawn external processes that require **real filesystem paths**:

| Component | External Tools | Requirement |
|-----------|---------------|-------------|
| `src/compile/build.ts` | pdflatex, latexmk, xelatex, etc. | Working directory + input files |
| `src/compile/recipe.ts` | Same | Tool execution |
| `src/compile/external.ts` | User-defined commands | File paths as arguments |
| `src/locate/synctex.ts` | synctex | PDF and TeX file paths |
| `src/lint/latex-linter/chktex.ts` | chktex | TeX file path |
| `src/lint/latex-linter/lacheck.ts` | lacheck | TeX file path |
| `src/lint/latex-formatter/latexindent.ts` | latexindent | TeX file path |
| `src/lint/latex-formatter/tex-fmt.ts` | tex-fmt | TeX file path |
| `src/core/file.ts` | kpsewhich | Package resolution |

### 5. fsPath Usage Points (21 files)

The `.fsPath` property is used extensively to extract local filesystem paths from URIs:

- `src/compile/build.ts` (2 occurrences)
- `src/compile/recipe.ts` (2 occurrences)
- `src/compile/external.ts` (1 occurrence)
- `src/core/root.ts` (10 occurrences)
- `src/core/cache.ts` (5 occurrences)
- `src/core/watcher.ts` (9 occurrences)
- `src/locate/synctex.ts` (5 occurrences)
- And others...

### 6. Current URI Scheme Filtering

The extension filters documents by URI scheme in several places:

```typescript
// src/main.ts
if (!lw.constant.FILE_URI_SCHEMES.includes(e.uri.scheme)) {
    return
}
```

This currently limits processing to `file://` and `vsls://` schemes.

## Implementation Strategy

### Phase 1: URI-Based Abstraction Layer

**Goal:** Create a unified file system abstraction that handles both local and virtual files.

1. **Extend `src/core/file.ts`:**
   ```typescript
   export const file = {
       // ... existing exports
       isVirtual,           // Check if URI is from a virtual filesystem
       materializeUri,      // Copy VFS file to local temp directory
       syncToLocal,         // Sync entire project to local temp directory
       getLocalPath,        // Get local path for a URI (materializing if needed)
   }
   ```

2. **Create VFS Sync Service (`src/core/vfs-sync.ts`):**
   ```typescript
   export const vfsSync = {
       syncProject,         // Sync all project files to temp directory
       getLocalMapping,     // Get URI -> local path mapping
       cleanup,             // Clean up synced files
       watchForChanges,     // Watch VFS for changes and re-sync
   }
   ```

### Phase 2: Extend URI Scheme Support

1. **Update `lw.constant.FILE_URI_SCHEMES`:**
   ```typescript
   // Support all schemes that provide file content
   // Core schemes are hardcoded, additional schemes can be configured
   FILE_URI_SCHEMES: ['file', 'vsls', 'vscode-remote', 'vscode-vfs']
   
   // Dynamic scheme detection: Any workspace folder URI scheme is automatically supported
   function isSupportedScheme(scheme: string): boolean {
       return FILE_URI_SCHEMES.includes(scheme) ||
              vscode.workspace.workspaceFolders?.some(f => f.uri.scheme === scheme) ||
              configuration.get('vfs.additionalSchemes').includes(scheme)
   }
   ```

2. **Update `toUri()` function:**
   ```typescript
   function toUri(filePath: string): vscode.Uri {
       // Handle multiple schemes dynamically
       // Detect scheme from workspace folder or default to 'file'
   }
   ```

### Phase 3: Build System Integration

**Goal:** Modify the build system to sync VFS files before compilation.

1. **Modify `src/compile/recipe.ts`:**
   ```typescript
   export async function build(rootFile: string, langId: string, ...) {
       // Check if rootFile is from VFS
       if (lw.file.isVirtual(rootFile)) {
           // Sync project to local temp directory
           const localProject = await lw.file.syncToLocal(rootFile)
           rootFile = localProject.rootFile
           // Update paths in tools
       }
       // ... existing build logic
   }
   ```

2. **Add post-build sync:**
   - Copy generated PDF and logs back to VFS if needed
   - Handle output directory mapping

### Phase 4: Gradual Migration of fs Usage

Replace direct `fs` usage with VFS-compatible alternatives:

| Original | Replacement |
|----------|-------------|
| `fs.readFileSync(path)` | `await vscode.workspace.fs.readFile(uri)` |
| `fs.existsSync(path)` | `await lw.file.exists(uri)` |
| `fs.writeFileSync(path, data)` | `await vscode.workspace.fs.writeFile(uri, data)` |
| `fs.readdirSync(dir)` | `await vscode.workspace.fs.readDirectory(uri)` |

**Exceptions:** Loading bundled extension data (e.g., from `data/*.json`) can remain synchronous since these are local extension files.

### Phase 5: Update Path Resolution

1. **Modify path resolution utilities:**
   - `utils.resolveFile()` - Support URI-based resolution
   - `utils.replaceArgumentPlaceholders()` - Handle VFS paths

2. **Update root file detection:**
   - `src/core/root.ts` - Support VFS root files
   - Ensure caching works with URI-based keys

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         VS Code                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Local Files   │  │   Remote Files  │  │   VFS Files     │ │
│  │   (file://)     │  │(vscode-remote://)│  │ (memfs://, etc) │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                     │          │
│           └────────────────────┼─────────────────────┘          │
│                                ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              vscode.workspace.fs API                        ││
│  └────────────────────────────┬────────────────────────────────┘│
└───────────────────────────────┼─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LaTeX Workshop Extension                      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              File System Abstraction (lw.file)              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐││
│  │  │   read()    │  │  exists()   │  │   isVirtual()        │││
│  │  │   toUri()   │  │  getOutDir()│  │   materializeUri()   │││
│  │  └─────────────┘  └─────────────┘  └──────────────────────┘││
│  └────────────────────────────┬────────────────────────────────┘│
│                               │                                  │
│  ┌────────────────────────────┼────────────────────────────────┐│
│  │              VFS Sync Service (lw.vfsSync)                  ││
│  │                            │                                 ││
│  │  If virtual:               ▼                                 ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │           Sync to Local Temp Directory                  │││
│  │  │  - Copy all project files to /tmp/lw-vfs-xxxxx/         │││
│  │  │  - Maintain path mapping                                │││
│  │  │  - Watch for changes                                    │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └────────────────────────────┬────────────────────────────────┘│
│                               │                                  │
│                               ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Build System (lw.compile)                      ││
│  │  - Uses local paths for external tools                      ││
│  │  - pdflatex, latexmk, synctex, etc.                         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Configuration Changes

Add new configuration options:

```json
{
  "latex-workshop.vfs.sync.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable automatic synchronization of virtual files to local disk for compilation."
  },
  "latex-workshop.vfs.sync.watchDelay": {
    "type": "number",
    "default": 500,
    "description": "Delay in milliseconds before re-syncing after file changes."
  },
  "latex-workshop.vfs.sync.excludePatterns": {
    "type": "array",
    "default": ["**/node_modules/**", "**/.git/**"],
    "description": "Patterns to exclude from VFS synchronization."
  },
  "latex-workshop.vfs.sync.maxDiskUsageMB": {
    "type": "number",
    "default": 500,
    "description": "Maximum disk usage in MB for synchronized VFS files. Older synced projects are cleaned up when limit is reached."
  },
  "latex-workshop.vfs.additionalSchemes": {
    "type": "array",
    "default": [],
    "description": "Additional URI schemes to treat as supported virtual file systems (e.g., 'memfs', 'github')."
  }
}
```

## Testing Strategy

1. **Unit Tests:**
   - Test `isVirtual()` with various URI schemes
   - Test `materializeUri()` file copying
   - Test path mapping consistency

2. **Integration Tests:**
   - Create mock VFS provider
   - Test full build cycle with VFS files
   - Test file watching and re-sync

3. **Manual Testing:**
   - Test with VS Code Remote - SSH
   - Test with VS Code Remote - Containers
   - Test with GitHub Codespaces
   - Test with custom VFS extensions (e.g., `memfs`)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance overhead from file sync | Medium | Incremental sync, file hashing |
| Disk space usage in temp directory | Low | Cleanup on extension deactivation, configurable size limits via `vfs.sync.maxDiskUsageMB`, LRU cleanup of old synced projects |
| Race conditions during sync | Medium | Lock mechanisms, debounced sync |
| Inconsistent state between VFS and local | High | Single-direction sync, clear error messages |
| Network latency for remote files | Medium | Progress indication, async operations |

## Migration Path

1. **Phase 1 (Non-breaking):**
   - Add VFS detection and sync infrastructure
   - Keep existing behavior as default

2. **Phase 2 (Opt-in):**
   - Enable VFS support via configuration
   - Gather feedback from users

3. **Phase 3 (Default):**
   - Make VFS support the default behavior
   - Remove legacy code paths

## Files Requiring Modification

### High Priority (Core Functionality)

1. `src/core/file.ts` - Add VFS detection and materialization
2. `src/compile/recipe.ts` - Integrate VFS sync before build
3. `src/compile/build.ts` - Handle VFS root files
4. `src/lw.ts` - Add VFS sync service
5. `src/main.ts` - Extend URI scheme filtering

### Medium Priority (Feature Completeness)

6. `src/core/root.ts` - Support VFS root file detection
7. `src/core/cache.ts` - URI-based caching
8. `src/core/watcher.ts` - VFS file watching
9. `src/locate/synctex.ts` - Handle VFS PDFs

### Lower Priority (Tool Integration)

10. `src/lint/latex-linter/*.ts` - VFS support for linting
11. `src/lint/latex-formatter/*.ts` - VFS support for formatting
12. `src/completion/completer/*.ts` - Input path completion for VFS

## Estimated Effort

| Phase | Effort | Duration |
|-------|--------|----------|
| Phase 1: Abstraction Layer | Medium | 2-3 weeks |
| Phase 2: URI Scheme Support | Low | 1 week |
| Phase 3: Build Integration | High | 3-4 weeks |
| Phase 4: fs Migration | Medium | 2-3 weeks |
| Phase 5: Path Resolution | Medium | 2 weeks |
| Testing & Documentation | Medium | 2 weeks |
| **Total** | | **12-15 weeks** |

## Conclusion

Adding VFS support to LaTeX Workshop is a significant undertaking that requires:
1. Creating a file system abstraction layer
2. Implementing a VFS-to-local sync mechanism
3. Gradually migrating direct filesystem usage
4. Extensive testing across different VFS providers

The key challenge is that external LaTeX tools require real filesystem paths, making a sync mechanism essential. The proposed architecture maintains backward compatibility while enabling full VFS support through incremental improvements.
