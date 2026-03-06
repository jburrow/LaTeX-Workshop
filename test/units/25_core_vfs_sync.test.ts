import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as sinon from 'sinon'
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
        sinon.restore()
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

        it('should sync a VFS project to local disk', async () => {
            set.config('vfs.sync.enabled', true)

            // Create a mock virtual URI
            const uri = vscode.Uri.parse('memfs:/test-project')

            // Stub the workspace.fs.readDirectory to return mock files
            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory').resolves([
                ['main.tex', vscode.FileType.File],
                ['chapter.tex', vscode.FileType.File]
            ])

            // Stub the workspace.fs.readFile to return mock content
            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('\\documentclass{article}'))

            const result = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            // The result should be a SyncedProject
            assert.ok(result, 'syncProject should return a project')
            assert.ok(result.localRootPath.length > 0, 'localRootPath should not be empty')
            assert.strictEqual(result.rootUri.toString(), uri.toString())
        })

        it('should refresh an already synced project when called again', async () => {
            set.config('vfs.sync.enabled', true)

            const uri = vscode.Uri.parse('memfs:/test-project-refresh')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory').resolves([
                ['main.tex', vscode.FileType.File]
            ])
            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content1'))

            // First sync
            const result1 = await lw.vfsSync.syncProject(uri)
            assert.ok(result1, 'First sync should succeed')

            // Second sync should refresh
            readFileStub.resolves(Buffer.from('content2'))
            const result2 = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(result2, 'Second sync should succeed')
            assert.strictEqual(result1.localRootPath, result2.localRootPath, 'Should use the same local path')
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

        it('should sync a single VFS file to local disk', async () => {
            set.config('vfs.sync.enabled', true)

            const uri = vscode.Uri.parse('memfs:/single-file.tex')

            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('\\documentclass{article}'))

            const result = await lw.vfsSync.syncFile(uri)

            readFileStub.restore()

            assert.ok(result, 'syncFile should return a path')
            assert.ok(result.includes('.tex'), 'synced file should have .tex extension')
            assert.ok(fs.existsSync(result), 'synced file should exist on disk')

            // Clean up
            if (fs.existsSync(result)) {
                fs.unlinkSync(result)
            }
        })
    })

    describe('lw.vfsSync.getLocalPath', () => {
        it('should return fsPath for local files', async () => {
            const localPath = '/local/path/to/file.tex'
            const uri = vscode.Uri.file(localPath)
            const result = await lw.vfsSync.getLocalPath(uri)
            assert.pathStrictEqual(result, localPath)
        })

        it('should sync and return local path for VFS files', async () => {
            set.config('vfs.sync.enabled', true)

            const uri = vscode.Uri.parse('memfs:/get-local-path-test.tex')

            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const result = await lw.vfsSync.getLocalPath(uri)

            readFileStub.restore()

            assert.ok(result, 'getLocalPath should return a path')
            assert.ok(fs.existsSync(result), 'returned path should exist on disk')

            // Clean up
            if (result && fs.existsSync(result)) {
                fs.unlinkSync(result)
            }
        })
    })

    describe('lw.vfsSync.cleanup', () => {
        it('should clean up a specific synced project', async () => {
            set.config('vfs.sync.enabled', true)

            const uri = vscode.Uri.parse('memfs:/cleanup-test-project')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory').resolves([
                ['main.tex', vscode.FileType.File]
            ])
            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const project = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(project, 'Project should be synced')
            assert.ok(fs.existsSync(project.localRootPath), 'Project directory should exist')

            // Cleanup specific project
            lw.vfsSync.cleanup(uri)

            assert.ok(!fs.existsSync(project.localRootPath), 'Project directory should be removed after cleanup')
        })

        it('should clean up all synced projects when called without argument', async () => {
            set.config('vfs.sync.enabled', true)

            const uri1 = vscode.Uri.parse('memfs:/cleanup-all-test-1')
            const uri2 = vscode.Uri.parse('memfs:/cleanup-all-test-2')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory').resolves([
                ['main.tex', vscode.FileType.File]
            ])
            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const project1 = await lw.vfsSync.syncProject(uri1)
            const project2 = await lw.vfsSync.syncProject(uri2)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(project1, 'Project 1 should be synced')
            assert.ok(project2, 'Project 2 should be synced')

            // Cleanup all
            lw.vfsSync.cleanup()

            // Both directories should be removed
            assert.ok(!fs.existsSync(project1.localRootPath), 'Project 1 directory should be removed')
            assert.ok(!fs.existsSync(project2.localRootPath), 'Project 2 directory should be removed')
        })
    })

    describe('VFS exclude patterns', () => {
        it('should exclude node_modules directory by default', async () => {
            set.config('vfs.sync.enabled', true)
            set.config('vfs.sync.excludePatterns', ['**/node_modules/**'])

            const uri = vscode.Uri.parse('memfs:/exclude-test-project')

            // Mock directory structure with node_modules
            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory')
            readDirStub.onFirstCall().resolves([
                ['main.tex', vscode.FileType.File],
                ['node_modules', vscode.FileType.Directory]
            ])
            readDirStub.onSecondCall().resolves([
                ['package.json', vscode.FileType.File]
            ])

            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const project = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(project, 'Project should be synced')

            // node_modules should not be synced (only main.tex should be in mappings)
            const mappingKeys = Array.from(project.mappings.keys())
            const hasNodeModules = mappingKeys.some(key => key.includes('node_modules'))
            assert.strictEqual(hasNodeModules, false, 'node_modules should be excluded')
        })

        it('should exclude .git directory by default', async () => {
            set.config('vfs.sync.enabled', true)
            set.config('vfs.sync.excludePatterns', ['**/.git/**'])

            const uri = vscode.Uri.parse('memfs:/exclude-git-project')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory')
            readDirStub.onFirstCall().resolves([
                ['main.tex', vscode.FileType.File],
                ['.git', vscode.FileType.Directory]
            ])
            readDirStub.onSecondCall().resolves([
                ['config', vscode.FileType.File]
            ])

            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const project = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(project, 'Project should be synced')

            const mappingKeys = Array.from(project.mappings.keys())
            const hasGit = mappingKeys.some(key => key.includes('.git'))
            assert.strictEqual(hasGit, false, '.git should be excluded')
        })

        it('should support custom exclude patterns', async () => {
            set.config('vfs.sync.enabled', true)
            set.config('vfs.sync.excludePatterns', ['**/build/**', '**/*.log'])

            const uri = vscode.Uri.parse('memfs:/custom-exclude-project')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory')
            readDirStub.onFirstCall().resolves([
                ['main.tex', vscode.FileType.File],
                ['output.log', vscode.FileType.File],
                ['build', vscode.FileType.Directory]
            ])
            readDirStub.onSecondCall().resolves([
                ['main.pdf', vscode.FileType.File]
            ])

            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            const project = await lw.vfsSync.syncProject(uri)

            readDirStub.restore()
            readFileStub.restore()

            assert.ok(project, 'Project should be synced')

            const mappingKeys = Array.from(project.mappings.keys())

            // Should have main.tex but not output.log or build directory
            const hasMainTex = mappingKeys.some(key => key.includes('main.tex'))
            const hasLog = mappingKeys.some(key => key.includes('.log'))
            const hasBuild = mappingKeys.some(key => key.includes('build'))

            assert.strictEqual(hasMainTex, true, 'main.tex should be synced')
            assert.strictEqual(hasLog, false, '.log files should be excluded')
            assert.strictEqual(hasBuild, false, 'build directory should be excluded')
        })
    })

    describe('lw.vfsSync.getVfsMapping', () => {
        it('should return undefined for unmapped files', () => {
            const uri = vscode.Uri.parse('memfs:/unmapped/file.tex')
            const mapping = lw.vfsSync.getVfsMapping(uri)
            assert.strictEqual(mapping, undefined)
        })

        it('should return mapping for synced files', async () => {
            set.config('vfs.sync.enabled', true)

            const projectUri = vscode.Uri.parse('memfs:/mapping-test-project')
            const fileUri = vscode.Uri.parse('memfs:/mapping-test-project/main.tex')

            const readDirStub = sinon.stub(vscode.workspace.fs, 'readDirectory').resolves([
                ['main.tex', vscode.FileType.File]
            ])
            const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').resolves(Buffer.from('content'))

            await lw.vfsSync.syncProject(projectUri)

            readDirStub.restore()
            readFileStub.restore()

            const mapping = lw.vfsSync.getVfsMapping(fileUri)

            // Clean up
            lw.vfsSync.cleanup(projectUri)

            assert.ok(mapping, 'Mapping should exist for synced file')
            assert.ok(mapping.localPath.length > 0, 'localPath should not be empty')
            assert.ok(mapping.lastSynced > 0, 'lastSynced should be set')
        })
    })
})
