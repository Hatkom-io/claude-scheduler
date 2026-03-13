#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, resolve } from 'node:path'

const schedulerDir = resolve(import.meta.dirname)
const daemonPath = resolve(schedulerDir, 'daemon.ts')
const logDir = resolve(schedulerDir, 'logs')

const shouldUninstall = process.argv.includes('--uninstall')

const log = (message: string) => console.log(`  ${message}`)

const getUid = () => {
  if (!process.getuid) {
    throw new Error('process.getuid is not available on this platform')
  }
  return process.getuid()
}

const nodePath = (() => {
  try {
    return execSync('which bun', { encoding: 'utf-8' }).trim()
  } catch {
    try {
      return execSync('which node', { encoding: 'utf-8' }).trim()
    } catch {
      return 'node'
    }
  }
})()

const installLaunchd = () => {
  const label = 'com.sfs.review-bot'
  const plistPath = resolve(
    homedir(),
    'Library/LaunchAgents',
    `${label}.plist`,
  )

  if (shouldUninstall) {
    try {
      execSync(
        `launchctl bootout gui/${getUid()} ${plistPath}`,
        { stdio: 'ignore' },
      )
    } catch { /* may not be loaded */ }

    if (existsSync(plistPath)) {
      unlinkSync(plistPath)
    }

    log(`Removed ${plistPath}`)
    return
  }

  mkdirSync(logDir, { recursive: true })
  mkdirSync(dirname(plistPath), { recursive: true })

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${daemonPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${schedulerDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`

  writeFileSync(plistPath, plist)

  try {
    execSync(
      `launchctl bootout gui/${getUid()} ${plistPath}`,
      { stdio: 'ignore' },
    )
  } catch { /* may not be loaded yet */ }

  execSync(`launchctl bootstrap gui/${getUid()} ${plistPath}`)

  log(`Installed: ${plistPath}`)
  log(`Logs: ${logDir}/stdout.log`)
  log('The daemon will auto-start on login and restart if it crashes.')
}

const installSystemd = () => {
  const unitName = 'sfs-review-bot'
  const unitDir = resolve(homedir(), '.config/systemd/user')
  const unitPath = resolve(unitDir, `${unitName}.service`)

  if (shouldUninstall) {
    try {
      execSync(`systemctl --user stop ${unitName}`, { stdio: 'ignore' })
      execSync(`systemctl --user disable ${unitName}`, { stdio: 'ignore' })
    } catch { /* may not exist */ }

    if (existsSync(unitPath)) {
      unlinkSync(unitPath)
    }

    execSync('systemctl --user daemon-reload', { stdio: 'ignore' })
    log(`Removed ${unitPath}`)
    return
  }

  mkdirSync(unitDir, { recursive: true })
  mkdirSync(logDir, { recursive: true })

  const unit = `[Unit]
Description=SFS PR Review Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
WorkingDirectory=${schedulerDir}
Restart=on-failure
RestartSec=60
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target`

  writeFileSync(unitPath, unit)
  execSync('systemctl --user daemon-reload')
  execSync(`systemctl --user enable --now ${unitName}`)

  log(`Installed: ${unitPath}`)
  log(`Status: systemctl --user status ${unitName}`)
  log(`Logs: journalctl --user -u ${unitName} -f`)
  log('The daemon will auto-start on login and restart if it crashes.')
}

const installWindows = () => {
  const taskName = 'SFS-ReviewBot'

  if (shouldUninstall) {
    try {
      execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore' })
    } catch { /* may not exist */ }

    log(`Removed scheduled task: ${taskName}`)
    return
  }

  mkdirSync(logDir, { recursive: true })

  const wrapperPath = resolve(schedulerDir, 'start-daemon.bat')
  const bat = `@echo off\r\ncd /d "${schedulerDir}"\r\n"${nodePath}" "${daemonPath}" >> "${logDir}\\stdout.log" 2>> "${logDir}\\stderr.log"\r\n`
  writeFileSync(wrapperPath, bat)

  try {
    execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore' })
  } catch { /* may not exist */ }

  execSync(
    `schtasks /create /tn "${taskName}" /tr "${wrapperPath}" /sc onlogon /rl limited /f`,
  )

  execSync(`schtasks /run /tn "${taskName}"`)

  log(`Installed scheduled task: ${taskName}`)
  log(`Logs: ${logDir}\\stdout.log`)
  log('The daemon will auto-start on logon.')
}

const preflight = () => {
  if (!existsSync(resolve(schedulerDir, 'config.json'))) {
    console.error(
      'Error: config.json not found.\n' +
      `Copy ${resolve(schedulerDir, 'config.example.json')} to config.json and fill in your repositories.`,
    )
    process.exit(1)
  }

  try {
    execSync('gh auth status', { stdio: 'ignore' })
  } catch {
    console.error(
      'Error: gh CLI is not authenticated. Run `gh auth login` first.',
    )
    process.exit(1)
  }

  try {
    execSync('claude --version', { stdio: 'ignore' })
  } catch {
    console.error('Error: claude CLI not found. Install it first.')
    process.exit(1)
  }
}

const os = platform()
const action = shouldUninstall ? 'Uninstalling' : 'Installing'

console.log(`\n${action} SFS Review Bot (${os})...\n`)

if (!shouldUninstall) {
  preflight()
}

switch (os) {
  case 'darwin':
    installLaunchd()
    break
  case 'linux':
    installSystemd()
    break
  case 'win32':
    installWindows()
    break
  default:
    console.error(`Unsupported platform: ${os}`)
    console.error(
      'You can run the daemon manually: bun claude-scheduler/daemon.ts',
    )
    process.exit(1)
}

console.log('\nDone!\n')
