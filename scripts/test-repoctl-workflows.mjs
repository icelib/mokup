/* eslint-disable no-template-curly-in-string -- GitHub Actions expressions must stay literal in these contract tests. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { loadMonorepoConfig } from 'repoctl'
import YAML from 'yaml'

const root = new URL('../', import.meta.url)

async function readWorkflow(name) {
  const source = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8')
  const document = YAML.parseDocument(source)
  assert.deepEqual(document.errors, [], `${name} must be valid YAML`)
  return document.toJS()
}

const [release, documentation, deploy, ci, config, manifest] = await Promise.all([
  readWorkflow('release'),
  readWorkflow('repoctl-docs'),
  readWorkflow('repoctl-docs-deploy'),
  readWorkflow('ci'),
  loadMonorepoConfig(root.pathname),
  readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
])

function evaluate(expression, context) {
  const source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').replace(/\.([a-z]+(?:-[a-z]+)+)/g, '["$1"]')
  return runInNewContext(source, { cancelled: () => false, ...context }, { timeout: 100 })
}

function event(eventName, mode = '', ref = 'refs/heads/main') {
  return {
    github: {
      event_name: eventName,
      event: { schedule: config.commands.release.nightly.schedule, repository: { default_branch: 'main' } },
      ref,
      sha: 'a'.repeat(40),
    },
    inputs: { mode, 'channel': 'stable', 'source-sha': '', 'dry-run': false, 'release': '' },
  }
}

function commands(job) {
  return job.steps.flatMap(step => typeof step.run === 'string' ? [step.run] : [])
}

test('release, nightly and OIDC routes are mutually exclusive', () => {
  for (const [eventName, mode, expected] of [
    ['push', '', 'release'],
    ['schedule', '', 'nightly'],
    ['workflow_dispatch', 'auto', 'release'],
    ['workflow_dispatch', 'publish', 'release'],
    ['workflow_dispatch', 'nightly', 'nightly'],
    ['workflow_dispatch', 'oidc-audit', 'oidc-audit'],
  ]) {
    const selected = ['release', 'nightly', 'oidc-audit']
      .filter(name => evaluate(release.jobs[name].if, event(eventName, mode)))
    assert.deepEqual(selected, [expected], `${eventName}/${mode} must select only ${expected}`)
  }
  assert.ok(release.on.workflow_dispatch.inputs.mode.options.includes('nightly'))
  assert.ok(release.on.workflow_dispatch.inputs.mode.options.includes('oidc-audit'))
  assert.equal(release.concurrency['cancel-in-progress'], false)
})

test('nightly schedule, provider and permissions match repoctl configuration', () => {
  const nightly = config.commands.release.nightly
  assert.equal(nightly.provider, 'npm')
  assert.equal(nightly.schedule, '17 19 * * *')
  assert.ok(release.on.schedule.some(item => item.cron === nightly.schedule))
  assert.equal(release.jobs.nightly.env.REPOCTL_NIGHTLY_PROVIDER, nightly.provider)
  assert.equal(release.jobs.nightly.env.REPOCTL_NIGHTLY_SCHEDULE, nightly.schedule)
  assert.deepEqual(release.jobs.nightly.permissions, { 'contents': 'read', 'id-token': 'write' })
  const unrelatedSchedule = event('schedule')
  unrelatedSchedule.github.event.schedule = '0 0 * * *'
  assert.equal(evaluate(release.jobs.nightly.if, unrelatedSchedule), false)
  const source = release.jobs.nightly.steps.find(step => step.name === 'Validate nightly source')
  assert.match(source.run, /GITHUB_REF.*refs\/heads\/\$DEFAULT_BRANCH/)
  const checkout = release.jobs.nightly.steps.find(step => step.id === 'nightly-checkout')
  assert.equal(checkout.with.ref, '${{ github.sha }}')
  assert.equal(checkout.with['persist-credentials'], false)
})

test('nightly runs full release verification with native dependencies and browser prerequisites', () => {
  const qualityScripts = config.commands.release.qualityScripts
  assert.equal(manifest.scripts['release:check'], qualityScripts.map(script => `pnpm run ${script}`).join(' && '))
  const fullCheck = qualityScripts.flatMap(script => manifest.scripts[script].split(' && '))
  assert.deepEqual(fullCheck, [
    'guard:migration',
    'lint:lines:guard',
    'test:release-tools',
    'typecheck',
    'build',
    'lint',
    'test',
    'test:types',
    'test:e2e:serial',
    'test:e2e:d1',
    'release:pack-check',
    'test:mock-package-contract',
  ].map(script => `pnpm run ${script}`))
  const steps = release.jobs.nightly.steps
  const publishIndex = steps.findIndex(step => step.id === 'nightly-publish')
  const setup = commands({ steps: steps.slice(0, publishIndex) })
  assert.ok(setup.includes('pnpm install --frozen-lockfile --ignore-scripts'))
  assert.ok(setup.some(command => command.startsWith('pnpm rebuild')))
  assert.ok(setup.includes('pnpm exec playwright install chrome --with-deps'))
  const browser = steps.find(step => step.run === 'pnpm exec playwright install chrome --with-deps')
  assert.equal(browser.if, undefined, 'system libraries are needed even when browser cache is restored')
  assert.equal(Number(release.env.LEFTHOOK), 0)
  assert.equal(steps[publishIndex].env.REPOCTL_SNAPSHOT_PUBLISH, '1')
})

test('stable release stages preserve source identity and publication gates', () => {
  const steps = release.jobs.release.steps
  const stages = steps.filter(step => step.run?.startsWith('pnpm exec repo release ci --stage '))
  assert.deepEqual(stages.map(step => step.id), ['plan', 'verify', 'prepare', 'upload', 'confirm', 'finalize'].map(stage => `release-${stage}`))
  for (const stage of stages) {
    assert.equal(stage.env.REPO_RELEASE_SOURCE_SHA, '${{ github.sha }}')
    assert.equal(stage.env.REPO_RELEASE_RECOVERY_SOURCE_SHA, '${{ inputs.source-sha }}')
  }
  for (const stage of stages.slice(3)) {
    assert.equal(stage.if, '${{ steps.release-prepare.outputs.publish == \'true\' }}')
  }
  const identityGuard = steps.find(step => step.name === 'Validate trusted publishing source')
  const original = event('workflow_dispatch', 'publish')
  original.inputs['source-sha'] = original.github.sha
  assert.equal(evaluate(identityGuard.if, original), false)
  original.inputs['source-sha'] = 'b'.repeat(40)
  assert.equal(evaluate(identityGuard.if, original), true)
  const prereleaseGuard = steps.find(step => step.name === 'Validate prerelease source commit')
  assert.match(prereleaseGuard.run, /plan\.status !== 'empty'/)
  assert.ok(commands(release.jobs.release).includes('pnpm peers check'))
  assert.ok(commands(release.jobs.release).includes('pnpm run test:release-tools'))
})

test('stable documentation requires a completed release record and selected sites', () => {
  assert.equal(release.jobs.release.outputs['release-record'], '${{ steps.release-finalize.outputs.release-record }}')
  assert.equal(release.jobs.release.outputs['docs-sites'], '${{ steps.release-finalize.outputs.docs-sites }}')
  const job = release.jobs.docs
  assert.equal(job.needs, 'release')
  assert.equal(job.with.channel, 'stable')
  assert.equal(job.with.release, '${{ needs.release.outputs.release-record }}')
  for (const [record, sites, ref, expected] of [
    ['', '["mokup"]', 'refs/heads/main', false],
    ['release-id', '[]', 'refs/heads/main', false],
    ['release-id', '["mokup"]', 'refs/heads/alpha', false],
    ['release-id', '["mokup"]', 'refs/heads/main', true],
  ]) {
    assert.equal(evaluate(job.if, {
      ...event('push', '', ref),
      needs: { release: { outputs: { 'release-record': record, 'docs-sites': sites } } },
    }), expected)
  }
})

test('main pushes deploy only preview documentation while manual stable corrections remain available', () => {
  assert.deepEqual(documentation.on.push.branches, ['main'])
  const push = event('push')
  assert.equal(evaluate(documentation.jobs.deploy.with.channel, push), 'preview')
  assert.equal(evaluate(documentation.jobs.deploy.with['source-sha'], push), push.github.sha)
  const manual = event('workflow_dispatch')
  assert.equal(evaluate(documentation.jobs.deploy.with.channel, manual), 'stable')
  assert.equal(documentation.jobs.deploy.with.release, '${{ inputs.release }}')
  assert.equal(documentation.jobs.deploy.with.commits, '${{ inputs.commits }}')
  const job = deploy.jobs.deploy
  assert.equal(job.environment, 'docs-${{ inputs.site }}-${{ inputs.channel }}')
  assert.equal(deploy.concurrency.group, 'docs-${{ inputs.site }}-${{ inputs.channel }}')
  assert.equal(deploy.concurrency['cancel-in-progress'], false)
  assert.equal(evaluate(job.if, event('push', '', 'refs/heads/feature')), false)
  const deployStep = job.steps.find(step => step.run?.includes('repo docs deploy'))
  assert.equal(deployStep.env.REPO_DOCS_CONCURRENCY_GROUP, deploy.concurrency.group)
  assert.match(deployStep.run, /repo docs plan[\s\S]*repo docs deploy/)
})

test('workflow migration keeps cross-platform, consumer-runtime and Vite compatibility coverage', () => {
  assert.deepEqual(ci.jobs.build.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest'])
  assert.deepEqual(ci.jobs.runtime.strategy.matrix['node-version'], ['22.12.0', '24.22.1'])
  for (const command of ['pnpm run test:release-tools', 'pnpm exec repo doctor', 'pnpm exec repo release plan --branch main --json', 'pnpm run test:provider-matrix', 'pnpm run test:deployment-templates', 'pnpm run test:mock-package-contract', 'pnpm run test:types', 'pnpm run release:pack-check']) {
    assert.ok(commands(ci.jobs.build).includes(command), `CI must preserve ${command}`)
  }
  assert.ok(commands(ci.jobs['vite-compat']).includes('pnpm run test:vite-compat'))
  for (const command of ['pnpm run test:e2e:serial', 'pnpm run test:conformance', 'pnpm run test:e2e:d1']) {
    assert.ok(commands(ci.jobs.e2e).includes(command))
  }
  for (const workflow of [release, documentation, deploy, ci]) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/setup-node@')) {
          assert.ok(['24.22.1', '${{ matrix.node-version }}'].includes(String(step.with['node-version'])))
        }
        assert.notEqual(step.run, 'pnpm run tooling:build', 'consumer workflows must not build repoctl source tooling')
      }
    }
  }
})

test('publication and browser diagnostics survive failed runs', () => {
  const stable = release.jobs.release.steps.find(step => step.name === 'Preserve npm publish progress')
  assert.equal(stable.if, '${{ always() }}')
  assert.match(stable.with.path, /repoctl-ci-progress\.json/)
  const nightly = release.jobs.nightly.steps.find(step => step.name === 'Preserve nightly diagnostics')
  assert.equal(nightly.if, '${{ always() }}')
  for (const report of ['nightly-report.json', 'consumer-report.json', 'snapshot-report.json']) {
    assert.ok(nightly.with.path.includes(report))
  }
  for (const job of [release.jobs.release, release.jobs.nightly]) {
    const browser = job.steps.find(step => step.name === 'Preserve failed Playwright checks')
    assert.equal(browser.if, '${{ failure() }}')
    assert.match(browser.with.path, /apps\/\*\/playwright-report/)
  }
})
