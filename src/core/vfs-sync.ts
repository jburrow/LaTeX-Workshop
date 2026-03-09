import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import micromatch from 'micromatch'
import { lw } from '../lw'

const logger = lw.log('VFS')

/**
 * Represents a mapping between a virtual URI and its local path.
 */
interface VfsMapping {
    /** The original virtual URI */
    uri: vscode.Uri,
    /** The local filesystem path where the file is synced */
    localPath: string,
    /** Timestamp of last sync */
    lastSynced: number
}

/**
 * Represents a synced project with all its file mappings.
 */
interface SyncedProject {
    /** The root URI of the project in the virtual filesystem */
    rootUri: vscode.Uri,
    /** The local directory where the project is synced */
    localRootPath: string,
    /** Map of relative paths to their mappings */
    mappings: Map<string, VfsMapping>,
    /** Timestamp when the project was synced */
    syncedAt: number
}

/** Map of project root URI strings to synced projects */
const syncedProjects: Map<string, SyncedProject> = new Map()

/** VFS temp directory path */
let vfsTmpDir: string = ''

/**
 * VFS Sync Service for synchronizing virtual filesystem files to local disk.
 *
 * Since external LaTeX tools (pdflatex, latexmk, etc.) require real filesystem
 * paths, this service copies VFS files to a local temporary directory before
 * compilation.
 */
export const vfsSync = {
    initialize,
    isVirtual,
    syncProject,
    syncFile,
    getLocalPath,
    getVfsMapping,
    cleanup,
    getVfsTmpDir
}

/**
 * Initialize the VFS sync service by creating the temp directory.
 */
function initialize(): void {
    if (vfsTmpDir === '') {
        const tmpDir = path.join(os.tmpdir(), 'latex-workshop-vfs').split(path.sep).join('/')
        try {
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true })
            }
            vfsTmpDir = tmpDir
            logger.log(`VFS temp directory initialized: ${vfsTmpDir}`)
        } catch (error) {
            logger.logError('Failed to create VFS temp directory', error)
        }
    }
}

/**
 * Get the VFS temporary directory path.
 * @returns The path to the VFS temp directory.
 */
function getVfsTmpDir(): string {
    if (vfsTmpDir === '') {
        initialize()
    }
    return vfsTmpDir
}

/**
 * Check if a URI or path represents a virtual filesystem (not local file://).
 *
 * @param uriOrPath - A VS Code URI or a file path string.
 * @returns True if the resource is from a virtual filesystem.
 */
function isVirtual(uriOrPath: vscode.Uri | string): boolean {
    let uri: vscode.Uri
    if (typeof uriOrPath === 'string') {
        uri = lw.file.toUri(uriOrPath)
    } else {
        uri = uriOrPath
    }

    // 'file' scheme is local, everything else is considered virtual
    // Note: 'vsls' (Live Share) is treated as local for now since it has
    // special handling in the extension
    return uri.scheme !== 'file' && uri.scheme !== 'vsls'
}

/**
 * Sync an entire project from a virtual filesystem to local disk.
 *
 * @param rootUri - The root URI of the project in the virtual filesystem.
 * @returns The synced project info, including the local root path.
 */
async function syncProject(rootUri: vscode.Uri): Promise<SyncedProject | undefined> {
    if (!isVirtual(rootUri)) {
        logger.log(`Project is not virtual, no sync needed: ${rootUri.toString(true)}`)
        return undefined
    }

    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    if (!configuration.get<boolean>('vfs.sync.enabled', true)) {
        logger.log('VFS sync is disabled by configuration')
        return undefined
    }

    const excludePatterns = configuration.get<string[]>('vfs.sync.excludePatterns', ['**/node_modules/**', '**/.git/**'])

    // Check if already synced
    const existingProject = syncedProjects.get(rootUri.toString())
    if (existingProject) {
        logger.log(`Project already synced, refreshing: ${rootUri.toString(true)} -> ${existingProject.localRootPath}`)
        try {
            await syncDirectory(rootUri, existingProject.localRootPath, existingProject, excludePatterns)
            existingProject.syncedAt = Date.now()
        } catch (error) {
            logger.logError(`Failed to refresh VFS project: ${rootUri.toString(true)} -> ${existingProject.localRootPath}`, error)
        }
        return existingProject
    }

    logger.log(`Syncing project from VFS: ${rootUri.toString(true)}`)

    // Create a unique local directory for this project
    const projectHash = hashUri(rootUri)
    const localRootPath = path.join(getVfsTmpDir(), projectHash).split(path.sep).join('/')

    try {
        if (!fs.existsSync(localRootPath)) {
            fs.mkdirSync(localRootPath, { recursive: true })
        }
    } catch (error) {
        logger.logError(`Failed to create local directory for VFS project: ${localRootPath}`, error)
        return undefined
    }

    const project: SyncedProject = {
        rootUri,
        localRootPath,
        mappings: new Map(),
        syncedAt: Date.now()
    }

    // Recursively sync all files in the project
    await syncDirectory(rootUri, localRootPath, project, excludePatterns)

    syncedProjects.set(rootUri.toString(), project)
    logger.log(`Project synced: ${rootUri.toString(true)} -> ${localRootPath} (${project.mappings.size} files)`)

    return project
}

/**
 * Sync a single file from a virtual filesystem to local disk.
 *
 * @param fileUri - The URI of the file in the virtual filesystem.
 * @param projectRootUri - The root URI of the project (optional).
 * @returns The local path of the synced file.
 */
async function syncFile(fileUri: vscode.Uri, projectRootUri?: vscode.Uri): Promise<string | undefined> {
    if (!isVirtual(fileUri)) {
        return fileUri.fsPath
    }

    const configuration = vscode.workspace.getConfiguration('latex-workshop')
    if (!configuration.get<boolean>('vfs.sync.enabled', true)) {
        logger.log('VFS sync is disabled by configuration')
        return undefined
    }

    // If we have a project root, use project-based sync
    if (projectRootUri) {
        const project = await syncProject(projectRootUri)
        if (project) {
            const relativePath = getRelativePath(projectRootUri, fileUri)
            const mapping = project.mappings.get(relativePath)
            if (mapping) {
                return mapping.localPath
            }
        }
    }

    // Respect exclude patterns in fallback single-file sync path as well
    const excludePatterns = configuration.get<string[]>('vfs.sync.excludePatterns', ['**/node_modules/**', '**/.git/**'])
    const relativePath = projectRootUri ? getRelativePath(projectRootUri, fileUri) : fileUri.path.replace(/^\/+/, '')
    if (matchesExcludePattern(relativePath, excludePatterns) || matchesExcludePattern(fileUri.path, excludePatterns)) {
        logger.log(`Skipping excluded file from VFS sync fallback: ${fileUri.toString(true)}`)
        return undefined
    }

    // Otherwise, sync the single file
    const fileHash = hashUri(fileUri)
    const ext = path.extname(fileUri.path)
    const localPath = path.join(getVfsTmpDir(), 'files', `${fileHash}${ext}`).split(path.sep).join('/')

    try {
        const localDir = path.dirname(localPath)
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true })
        }

        const content = await vscode.workspace.fs.readFile(fileUri)
        fs.writeFileSync(localPath, content)
        logger.log(`File synced: ${fileUri.toString(true)} -> ${localPath}`)
        return localPath
    } catch (error) {
        logger.logError(`Failed to sync file: ${fileUri.toString(true)}`, error)
        return undefined
    }
}

/**
 * Get the local path for a virtual file, syncing it if necessary.
 *
 * @param uriOrPath - A VS Code URI or file path.
 * @param projectRootUri - The project root URI for context (optional).
 * @returns The local filesystem path for the file, or undefined if sync fails.
 */
async function getLocalPath(uriOrPath: vscode.Uri | string, projectRootUri?: vscode.Uri): Promise<string | undefined> {
    let uri: vscode.Uri
    if (typeof uriOrPath === 'string') {
        uri = lw.file.toUri(uriOrPath)
    } else {
        uri = uriOrPath
    }

    if (!isVirtual(uri)) {
        return uri.fsPath
    }

    const localPath = await syncFile(uri, projectRootUri)
    if (localPath) {
        return localPath
    }

    // If sync fails for a virtual file, log a warning and return undefined
    // External tools require real filesystem paths, so a virtual path won't work
    logger.log(`Warning: Failed to sync VFS file: ${uri.toString(true)}. Compilation may fail.`)
    return undefined
}

/**
 * Get the VFS mapping for a synced file.
 *
 * @param fileUri - The URI of the file.
 * @returns The VFS mapping if found, undefined otherwise.
 */
function getVfsMapping(fileUri: vscode.Uri): VfsMapping | undefined {
    for (const project of syncedProjects.values()) {
        const relativePath = getRelativePath(project.rootUri, fileUri)
        const mapping = project.mappings.get(relativePath)
        if (mapping) {
            return mapping
        }
    }
    return undefined
}

/**
 * Clean up synced files and directories.
 *
 * @param projectUri - Specific project to clean (optional). If not provided, cleans all.
 */
function cleanup(projectUri?: vscode.Uri): void {
    if (projectUri) {
        const project = syncedProjects.get(projectUri.toString())
        if (project) {
            try {
                fs.rmSync(project.localRootPath, { recursive: true, force: true })
                syncedProjects.delete(projectUri.toString())
                logger.log(`Cleaned up synced project: ${projectUri.toString(true)}`)
            } catch (error) {
                logger.logError(`Failed to cleanup synced project: ${projectUri.toString(true)}`, error)
            }
        }
    } else {
        // Clean all synced projects
        for (const [key, project] of syncedProjects) {
            try {
                fs.rmSync(project.localRootPath, { recursive: true, force: true })
            } catch {
                // Ignore cleanup errors
            }
            syncedProjects.delete(key)
        }
        logger.log('Cleaned up all synced VFS projects')
    }
}

// === Helper Functions ===

/**
 * Recursively sync a directory from VFS to local disk.
 */
async function syncDirectory(dirUri: vscode.Uri, localDir: string, project: SyncedProject, excludePatterns: string[]): Promise<void> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri)

        for (const [name, type] of entries) {
            const entryUri = vscode.Uri.joinPath(dirUri, name)
            const localPath = path.join(localDir, name).split(path.sep).join('/')
            const relativePath = getRelativePath(project.rootUri, entryUri)

            // Check exclude patterns
            if (matchesExcludePattern(relativePath, excludePatterns)) {
                continue
            }

            if ((type & vscode.FileType.SymbolicLink) !== 0) {
                logger.log(`Skipping symbolic link during VFS sync: ${entryUri.toString(true)}`)
            } else if (type === vscode.FileType.Directory) {
                if (!fs.existsSync(localPath)) {
                    fs.mkdirSync(localPath, { recursive: true })
                }
                await syncDirectory(entryUri, localPath, project, excludePatterns)
            } else if (type === vscode.FileType.File) {
                try {
                    const content = await vscode.workspace.fs.readFile(entryUri)
                    fs.writeFileSync(localPath, content)

                    project.mappings.set(relativePath, {
                        uri: entryUri,
                        localPath,
                        lastSynced: Date.now()
                    })
                } catch (error) {
                    logger.logError(`Failed to sync file: ${entryUri.toString(true)}`, error)
                }
            }
        }
    } catch (error) {
        logger.logError(`Failed to read directory: ${dirUri.toString(true)}`, error)
    }
}

/**
 * Get the relative path between a root URI and a file URI.
 */
function getRelativePath(rootUri: vscode.Uri, fileUri: vscode.Uri): string {
    const rootPath = rootUri.path.endsWith('/') ? rootUri.path : rootUri.path + '/'
    if (fileUri.path.startsWith(rootPath)) {
        return fileUri.path.substring(rootPath.length)
    }
    return fileUri.path
}

/**
 * Create a collision-resistant hash from a URI for unique directory/file names.
 */
function hashUri(uri: vscode.Uri): string {
    return crypto.createHash('sha256').update(uri.toString()).digest('hex').substring(0, 16)
}

/**
 * Check if a path matches any exclude pattern using micromatch.
 * This correctly handles glob patterns like `**\/node_modules/**` for top-level matches.
 */
function matchesExcludePattern(relativePath: string, patterns: string[]): boolean {
    if (patterns.length === 0) {
        return false
    }
    return micromatch.isMatch(relativePath, patterns, { dot: true })
}
