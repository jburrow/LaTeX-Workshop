import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { assert, set } from './utils'
import { lw } from '../../src/lw'

describe(path.basename(__filename).split('.')[0] + ':', () => {
    before(() => {
        // Initialize VFS sync service
        lw.vfsSync.initialize()
    })

    after(() => {
        // Clean up all synced projects
        lw.vfsSync.cleanup()
    })

    describe('lw.vfsSync.initialize', () => {
        it('should create VFS temp directory', () => {
            const tmpDir = lw.vfsSync.getVfsTmpDir()
            assert.ok(tmpDir.length > 0, 'VFS temp directory should not be empty')
            assert.ok(tmpDir.includes('latex-workshop-vfs'), 'VFS temp directory should include latex-workshop-vfs')
        })

        it('should return the same temp directory on repeated calls', () => {
            const tmpDir1 = lw.vfsSync.getVfsTmpDir()
            const tmpDir2 = lw.vfsSync.getVfsTmpDir()
            assert.strictEqual(tmpDir1, tmpDir2, 'Temp directory should be consistent')
        })

        it('should create a directory that exists on disk', () => {
            const tmpDir = lw.vfsSync.getVfsTmpDir()
            assert.ok(fs.existsSync(tmpDir), 'VFS temp directory should exist on disk')
        })
    })

    describe('lw.vfsSync.isVirtual', () => {
        it('should return false for file:// scheme', () => {
            const uri = vscode.Uri.file('/path/to/file.tex')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), false)
        })

        it('should return false for vsls:// scheme', () => {
            const uri = vscode.Uri.parse('vsls:/path/to/file.tex')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), false)
        })

        it('should return true for vscode-remote:// scheme', () => {
            const uri = vscode.Uri.parse('vscode-remote://ssh-remote+server/path/to/file.tex')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), true)
        })

        it('should return true for memfs:// scheme', () => {
            const uri = vscode.Uri.parse('memfs:/path/to/file.tex')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), true)
        })

        it('should return true for custom VFS schemes', () => {
            const uri = vscode.Uri.parse('custom-vfs:/project/main.tex')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), true)
        })

        it('should return true for untitled scheme', () => {
            const uri = vscode.Uri.parse('untitled:/Untitled-1')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), true)
        })

        it('should return true for vscode-userdata scheme', () => {
            const uri = vscode.Uri.parse('vscode-userdata:/user/settings.json')
            assert.strictEqual(lw.vfsSync.isVirtual(uri), true)
        })
    })

    describe('lw.vfsSync.syncProject', () => {
        it('should return undefined for local file:// URIs', async () => {
            const uri = vscode.Uri.file('/local/project')
            const result = await lw.vfsSync.syncProject(uri)
            assert.strictEqual(result, undefined)
        })

        it('should return undefined when vfs.sync.enabled is false', async () => {
            set.config('vfs.sync.enabled', false)
            const uri = vscode.Uri.parse('memfs:/project')
            const result = await lw.vfsSync.syncProject(uri)
            assert.strictEqual(result, undefined)
        })

        it('should return undefined for vsls:// URIs (treated as local)', async () => {
            const uri = vscode.Uri.parse('vsls:/shared/project')
            const result = await lw.vfsSync.syncProject(uri)
            assert.strictEqual(result, undefined)
        })
    })

    describe('lw.vfsSync.syncFile', () => {
        it('should return fsPath for local files', async () => {
            const localPath = '/local/path/to/file.tex'
            const uri = vscode.Uri.file(localPath)
            const result = await lw.vfsSync.syncFile(uri)
            assert.pathStrictEqual(result, localPath)
        })

        it('should return undefined when vfs.sync.enabled is false', async () => {
            set.config('vfs.sync.enabled', false)
            const uri = vscode.Uri.parse('memfs:/project/file.tex')
            const result = await lw.vfsSync.syncFile(uri)
            assert.strictEqual(result, undefined)
        })

        it('should return fsPath for vsls:// files (treated as local)', async () => {
            const uri = vscode.Uri.parse('vsls:/shared/file.tex')
            const result = await lw.vfsSync.syncFile(uri)
            // vsls is treated as local, so it returns the fsPath
            assert.pathStrictEqual(result, uri.fsPath)
        })
    })

    describe('lw.vfsSync.getLocalPath', () => {
        it('should return fsPath for local files', async () => {
            const localPath = '/local/path/to/file.tex'
            const uri = vscode.Uri.file(localPath)
            const result = await lw.vfsSync.getLocalPath(uri)
            assert.pathStrictEqual(result, localPath)
        })

        it('should return fsPath for vsls:// files', async () => {
            const uri = vscode.Uri.parse('vsls:/shared/file.tex')
            const result = await lw.vfsSync.getLocalPath(uri)
            assert.pathStrictEqual(result, uri.fsPath)
        })

        it('should handle string paths', async () => {
            const localPath = '/local/path/to/file.tex'
            const result = await lw.vfsSync.getLocalPath(localPath)
            assert.pathStrictEqual(result, localPath)
        })
    })

    describe('lw.vfsSync.cleanup', () => {
        it('should not throw when cleaning up non-existent project', () => {
            const uri = vscode.Uri.parse('memfs:/non-existent-project')
            // Should not throw
            lw.vfsSync.cleanup(uri)
            assert.ok(true, 'cleanup should not throw for non-existent projects')
        })

        it('should not throw when cleaning up all projects when none exist', () => {
            // First ensure all projects are cleaned
            lw.vfsSync.cleanup()
            // Call again - should not throw
            lw.vfsSync.cleanup()
            assert.ok(true, 'cleanup should not throw when no projects exist')
        })
    })

    describe('lw.vfsSync.getVfsMapping', () => {
        it('should return undefined for unmapped files', () => {
            const uri = vscode.Uri.parse('memfs:/unmapped/file.tex')
            const mapping = lw.vfsSync.getVfsMapping(uri)
            assert.strictEqual(mapping, undefined)
        })

        it('should return undefined for local files', () => {
            const uri = vscode.Uri.file('/local/file.tex')
            const mapping = lw.vfsSync.getVfsMapping(uri)
            assert.strictEqual(mapping, undefined)
        })
    })

    describe('VFS temp directory management', () => {
        it('should use platform temp directory', () => {
            const tmpDir = lw.vfsSync.getVfsTmpDir()
            // The temp directory should include the expected subdirectory name
            assert.ok(tmpDir.includes('latex-workshop-vfs'), 'Should include latex-workshop-vfs')
            // On some systems the path may differ slightly but should be in a reasonable location
            assert.ok(tmpDir.length > 0, 'Temp directory path should not be empty')
        })

        it('should return consistent path across calls', () => {
            const tmpDir1 = lw.vfsSync.getVfsTmpDir()
            const tmpDir2 = lw.vfsSync.getVfsTmpDir()
            const tmpDir3 = lw.vfsSync.getVfsTmpDir()
            assert.strictEqual(tmpDir1, tmpDir2, 'Path should be consistent')
            assert.strictEqual(tmpDir2, tmpDir3, 'Path should be consistent')
        })
    })
})
