import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const lefthookBin = require.resolve('lefthook/bin/index.js')
const configuration = fs.readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8')

// Exercise the actual Git hooks and file-selection commands. Small deterministic
// checkers replace lint/typecheck programs so failures test hook orchestration.
const checker = String.raw`
const fs = require('node:fs')
const [kind, ...args] = process.argv.slice(2)
fs.appendFileSync('order.log', kind + '\n')
if (fs.existsSync('fail-' + kind)) process.exit(1)
if (kind === 'eslint' || kind === 'stylelint') {
  const files = args.slice(args.indexOf('--') + 1)
  for (const file of files) {
    const value = fs.readFileSync(file, 'utf8')
    if (value.includes('UNSTAGED_SENTINEL')) throw new Error('unstaged content reached fixer')
    const marker = kind === 'eslint' ? 'BAD_JS' : 'BAD_CSS'
    fs.writeFileSync(file, value.replaceAll(marker, 'FIXED'))
  }
}
if (kind === 'commitlint') {
  const message = fs.readFileSync(args[0], 'utf8')
  fs.writeFileSync('message.log', message)
  if (!message.startsWith('feat:')) process.exit(1)
}
`

function write(cwd, filename, value) {
  const file = path.join(cwd, filename)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value)
}

function environment(cwd) {
  const env = { ...process.env }
  // Never inherit a caller's index/worktree when the test is run from a hook.
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) {
      delete env[key]
    }
  }
  return {
    ...env,
    CI: 'false',
    LEFTHOOK: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(cwd, 'global.gitconfig'),
  }
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment(cwd),
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.error) {
    throw result.error
  }
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function git(cwd, ...args) {
  const result = run(cwd, 'git', args)
  assert.equal(result.status, 0, result.output)
  return result.stdout.trimEnd()
}

function commit(cwd, message = 'feat: verify hooks') {
  return run(cwd, 'git', ['commit', '-qm', message])
}

function repository(t) {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'mokup-hooks-')))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  write(cwd, 'global.gitconfig', '')
  git(cwd, 'init', '-q')
  git(cwd, 'config', 'user.name', 'Hook Test')
  git(cwd, 'config', 'user.email', 'hooks@example.test')
  git(cwd, 'config', 'commit.gpgsign', 'false')
  git(cwd, 'config', 'core.autocrlf', 'false')
  const config = YAML.parse(configuration)
  const replacements = {
    'pnpm exec eslint': 'node hook-task.cjs eslint',
    'pnpm exec stylelint': 'node hook-task.cjs stylelint',
    'pnpm exec repo verify staged-typecheck': 'node hook-task.cjs staged-typecheck',
    'pnpm exec repo verify commit-msg': 'node hook-task.cjs commitlint',
    'pnpm lint': 'node hook-task.cjs lint',
    'pnpm typecheck': 'node hook-task.cjs typecheck',
  }
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
    for (const job of config[hook].jobs) {
      const entry = Object.entries(replacements).find(([command]) => job.run.includes(command))
      assert.ok(entry, `Unrecognized ${hook} command: ${job.run}`)
      job.run = job.run.replace(...entry)
    }
  }
  write(cwd, 'lefthook.yml', YAML.stringify(config))
  write(cwd, 'hook-task.cjs', checker)
  write(cwd, '.gitignore', 'order.log\nmessage.log\nfail-*\n')
  git(cwd, 'add', '.')
  git(cwd, '-c', `core.hooksPath=${path.join(cwd, 'no-hooks')}`, 'commit', '-qm', 'initial')
  const installed = run(cwd, process.execPath, [lefthookBin, 'install'])
  assert.equal(installed.status, 0, installed.output)
  return cwd
}

function stagedPartialFile(cwd) {
  const middle = Array.from({ length: 20 }, (_, index) => `// unchanged ${index}`).join('\n')
  const original = `original\n${middle}\noriginal end\n`
  write(cwd, 'partial.ts', original)
  git(cwd, 'add', 'partial.ts')
  const initial = commit(cwd)
  assert.equal(initial.status, 0, initial.output)
  write(cwd, 'partial.ts', original.replace('original\n', 'BAD_JS\n'))
  git(cwd, 'add', 'partial.ts')
  write(cwd, 'partial.ts', `BAD_JS\n${middle}\nUNSTAGED_SENTINEL\n`)
  write(cwd, 'unrelated.txt', 'UNSTAGED_SENTINEL\n')
  return {
    index: `FIXED\n${middle}\noriginal end`,
    working: `FIXED\n${middle}\nUNSTAGED_SENTINEL\n`,
  }
}

test('native hooks fix root/nested files in order and forward the commit message', (t) => {
  const cwd = repository(t)
  const vueFile = 'src/中文 component\'s.vue'
  const codeFiles = ['root.ts', '-root.ts', 'src/$(echo injected).ts']
  if (process.platform !== 'win32') {
    codeFiles.push('src/line\nbreak.ts', 'src/double"quote.ts')
  }
  write(cwd, vueFile, 'BAD_JS\nBAD_CSS\n')
  for (const filename of codeFiles) {
    write(cwd, filename, 'BAD_JS\n')
  }
  git(cwd, 'add', '--', vueFile, ...codeFiles)
  const result = commit(cwd)
  assert.equal(result.status, 0, result.output)
  assert.equal(git(cwd, 'show', `HEAD:${vueFile}`), 'FIXED\nFIXED')
  for (const filename of codeFiles) {
    assert.equal(git(cwd, 'show', `HEAD:${filename}`), 'FIXED')
  }
  assert.equal(fs.readFileSync(path.join(cwd, 'order.log'), 'utf8'), 'eslint\nstylelint\nstaged-typecheck\ncommitlint\n')
  assert.equal(fs.readFileSync(path.join(cwd, 'message.log'), 'utf8'), 'feat: verify hooks\n')
})

for (const fail of [false, true]) {
  test(`partial staging preserves unstaged content when checks ${fail ? 'fail' : 'pass'}`, (t) => {
    const cwd = repository(t)
    const expected = stagedPartialFile(cwd)
    const before = git(cwd, 'rev-parse', 'HEAD')
    write(cwd, 'order.log', '')
    fs.rmSync(path.join(cwd, 'message.log'))
    if (fail) {
      write(cwd, 'fail-staged-typecheck', '')
    }
    const result = commit(cwd)
    assert.equal(result.status === 0, !fail, result.output)
    if (fail) {
      assert.equal(git(cwd, 'rev-parse', 'HEAD'), before)
      assert.equal(git(cwd, 'show', ':partial.ts'), expected.index)
      assert.equal(fs.existsSync(path.join(cwd, 'message.log')), false)
    }
    else {
      assert.equal(git(cwd, 'show', 'HEAD:partial.ts'), expected.index)
      assert.equal(git(cwd, 'diff', '--cached'), '')
    }
    assert.equal(fs.readFileSync(path.join(cwd, 'partial.ts'), 'utf8'), expected.working)
    assert.equal(fs.readFileSync(path.join(cwd, 'unrelated.txt'), 'utf8'), 'UNSTAGED_SENTINEL\n')
    assert.equal(git(cwd, 'stash', 'list'), '')
  })
}

test('a restore conflict blocks the commit and preserves both original versions', (t) => {
  const cwd = repository(t)
  write(cwd, 'conflict.ts', 'original\n')
  git(cwd, 'add', 'conflict.ts')
  assert.equal(commit(cwd).status, 0)
  const before = git(cwd, 'rev-parse', 'HEAD')
  write(cwd, 'conflict.ts', 'BAD_JS staged\n')
  git(cwd, 'add', 'conflict.ts')
  write(cwd, 'conflict.ts', 'BAD_JS unstaged\n')
  write(cwd, 'unrelated.txt', 'keep unrelated changes\n')
  const rejected = commit(cwd)
  assert.notEqual(rejected.status, 0)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), before)
  assert.equal(git(cwd, 'show', ':conflict.ts'), 'BAD_JS staged')
  assert.equal(fs.readFileSync(path.join(cwd, 'conflict.ts'), 'utf8'), 'BAD_JS unstaged\n')
  assert.equal(fs.readFileSync(path.join(cwd, 'unrelated.txt'), 'utf8'), 'keep unrelated changes\n')
})

test('renamed files are fixed while deleted files never reach a fixer', (t) => {
  const cwd = repository(t)
  write(cwd, 'old.ts', 'original\n')
  write(cwd, 'deleted.ts', 'original\n')
  git(cwd, 'add', 'old.ts', 'deleted.ts')
  assert.equal(commit(cwd).status, 0)
  git(cwd, 'mv', 'old.ts', 'renamed 中文.ts')
  git(cwd, 'rm', 'deleted.ts')
  write(cwd, 'renamed 中文.ts', 'BAD_JS\n')
  git(cwd, 'add', 'renamed 中文.ts')
  const result = commit(cwd)
  assert.equal(result.status, 0, result.output)
  assert.equal(git(cwd, 'show', 'HEAD:renamed 中文.ts'), 'FIXED')
  write(cwd, 'order.log', '')
  git(cwd, 'rm', 'renamed 中文.ts')
  const removed = commit(cwd)
  assert.equal(removed.status, 0, removed.output)
  assert.equal(fs.readFileSync(path.join(cwd, 'order.log'), 'utf8'), 'staged-typecheck\ncommitlint\n')
})

test('commit-msg blocks rejection and pre-push stops at the first failure', (t) => {
  const cwd = repository(t)
  const before = git(cwd, 'rev-parse', 'HEAD')
  write(cwd, 'root.ts', 'value\n')
  git(cwd, 'add', 'root.ts')
  assert.notEqual(commit(cwd, 'invalid message').status, 0)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), before)
  write(cwd, 'order.log', '')
  const passed = run(cwd, process.execPath, [lefthookBin, 'run', 'pre-push'])
  assert.equal(passed.status, 0, passed.output)
  assert.equal(fs.readFileSync(path.join(cwd, 'order.log'), 'utf8'), 'lint\ntypecheck\n')
  write(cwd, 'order.log', '')
  write(cwd, 'fail-lint', '')
  const rejected = run(cwd, process.execPath, [lefthookBin, 'run', 'pre-push'])
  assert.notEqual(rejected.status, 0)
  assert.equal(fs.readFileSync(path.join(cwd, 'order.log'), 'utf8'), 'lint\n')
})
