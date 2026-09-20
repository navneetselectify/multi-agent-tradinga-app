export default async function auditLoggerPlugin() {
  return {
    "tool.execute.before": async (input: any) => {
      console.log(`[AUDIT BEFORE] ${input.tool}`)
    },

    "tool.execute.after": async (input: any) => {
      console.log(`[AUDIT AFTER] ${input.tool}`)
    },
  }
}