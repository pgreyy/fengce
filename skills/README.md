# skills

Agent skills. [`fengce/`](fengce/) (entry: [`fengce/SKILL.md`](fengce/SKILL.md)) makes an agent check a transaction against
a Safe's Fengce limits before acting and treat a refusal as final. Plugin Store format (`plugin.yaml`) with a plugin
manifest in `fengce/.claude-plugin/`.

```sh
npx skills add pgreyy/fengce --skill fengce
```
