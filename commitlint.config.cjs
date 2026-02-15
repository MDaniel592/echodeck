module.exports = {
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"],
    ],
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
  },
}
