import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runReviewCycle } from './reviewer.ts'
import { runFixCycle } from './fixer.ts'
import { runTestCycle } from './tester.ts'

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

const config = {
  intervalMinutes: 30,
  workingHours: { start: 9, end: 19 },
  workingDays: [1, 2, 3, 4, 5],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

const log = (message: string) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

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
      await runReviewCycle()
    } catch (error) {
      log(`Review cycle error: ${(error as Error).message}`)
    }

    try {
      await runFixCycle()
    } catch (error) {
      log(`Fix cycle error: ${(error as Error).message}`)
    }

    try {
      await runTestCycle()
    } catch (error) {
      log(`Test cycle error: ${(error as Error).message}`)
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
log(
  `Config: every ${config.intervalMinutes}min, ${config.workingHours.start}:00-${config.workingHours.end}:00, Mon-Fri`,
)
log(`Timezone: ${config.timezone}`)
log(`Working time now: ${isWorkingTime()}`)

scheduleNext()
