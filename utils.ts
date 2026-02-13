export type RepoEntry = string | { repo: string; path?: string }

export type Config = {
  repos: RepoEntry[]
  intervalMinutes: number
  workingHours: { start: number; end: number }
  workingDays: number[]
  label: string
  reviewedLabel: string
}

export const log = (message: string) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}
