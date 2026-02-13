import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runReviewCycle } from './reviewer.ts'
import { log, type Config } from './utils.ts'

const lockfilePath = resolve(import.meta.dirname, 'daemon.pid')

const acquireLock = () => {
  if (existsSync(lockfilePath)) {
    const existingPid = Number.parseInt(readFileSync(lockfilePath, 'utf-8').trim(), 10)

    if (Number.isNaN(existingPid)) {
      unlinkSync(lockfilePath)
    } else {
      try {
        process.kill(existingPid, 0)
        return false
      } catch {
        unlinkSync(lockfilePath)
      }
    }
  }

  writeFileSync(lockfilePath, String(process.pid))
  return true
}

const releaseLock = () => {
  try {
    if (existsSync(lockfilePath)) {
      const pid = Number.parseInt(readFileSync(lockfilePath, 'utf-8').trim(), 10)
      if (pid === process.pid) {
        unlinkSync(lockfilePath)
      }
    }
  } catch { /* best effort */ }
}

process.on('SIGINT', () => {
  releaseLock()
  process.exit(0)
})

process.on('SIGTERM', () => {
  releaseLock()
  process.exit(0)
})

process.on('exit', releaseLock)

const configPath = resolve(import.meta.dirname, 'config.json')
let config: Config
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'))
} catch (error) {
  console.error(`Failed to read config.json: ${(error as Error).message}. Copy config.example.json to config.json and edit it.`)
  process.exit(1)
}
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const isWorkingTime = () => {
  const now = new Date()
  const localHour = now.getHours()
  const dayOfWeek = now.getDay()

  if (!config.workingDays.includes(dayOfWeek)) {
    return false
  }

  return (
    localHour >= config.workingHours.start &&
    localHour < config.workingHours.end
  )
}

const getNextCheckDelay = () => {
  if (isWorkingTime()) {
    return config.intervalMinutes * 60 * 1000
  }

  const now = new Date()
  const localHour = now.getHours()
  const dayOfWeek = now.getDay()

  const nextWorkday = (() => {
    if (
      localHour < config.workingHours.start &&
      config.workingDays.includes(dayOfWeek)
    ) {
      return now
    }

    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(now)
      candidate.setDate(candidate.getDate() + offset)
      if (config.workingDays.includes(candidate.getDay())) {
        return candidate
      }
    }

    return now
  })()

  const nextStart = new Date(nextWorkday)
  nextStart.setHours(config.workingHours.start, 0, 0, 0)

  if (nextStart <= now) {
    nextStart.setDate(nextStart.getDate() + 1)
  }

  return nextStart.getTime() - now.getTime()
}

const scheduleNext = async () => {
  if (isWorkingTime()) {
    try {
      await runReviewCycle(config)
    } catch (error) {
      log(`Review cycle error: ${(error as Error).message}`)
    }
  }

  const delay = getNextCheckDelay()
  const nextRun = new Date(Date.now() + delay)
  log(
    `Next run at ${nextRun.toLocaleString()} (in ${Math.round(delay / 60000)} min)`,
  )

  setTimeout(scheduleNext, delay)
}

if (!acquireLock()) {
  log('Another instance is already running. Exiting.')
  process.exit(1)
}

log('Review bot starting')
log(`Repos: ${config.repos.map((r: any) => typeof r === 'string' ? r : r.repo).join(', ')}`)
log(
  `Config: every ${config.intervalMinutes}min, ${config.workingHours.start}:00-${config.workingHours.end}:00, Mon-Fri`,
)
log(`Timezone: ${timezone}`)
log(`Working time now: ${isWorkingTime()}`)

scheduleNext()
