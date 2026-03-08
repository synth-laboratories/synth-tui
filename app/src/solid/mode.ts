export type RendererMode = "solid" | "legacy"

type EnvMap = Record<string, string | undefined>

function normalizeFlag(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

export function resolveRendererMode(env: EnvMap): RendererMode {
  return normalizeFlag(env.SYNTH_TUI_RENDERER) === "solid" ? "solid" : "legacy"
}

export function shouldUseSolidRenderer(env: EnvMap): boolean {
  const explicit = normalizeFlag(env.SYNTH_TUI_RENDERER)
  if (explicit === "solid") {
    return true
  }
  if (explicit === "legacy") {
    return false
  }
  return ["1", "true", "yes", "on"].includes(normalizeFlag(env.SYNTH_TUI_SOLID))
}
