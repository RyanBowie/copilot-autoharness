# One-time automation setup

After installing the extension, paste this into a **new chat in the GitHub Copilot app**:

```text
Set up the two autoharness automations using save_workflow. Use global: true, host_id: "local", mode: "autopilot", enabled: true.
1. Name "Autoharness · Reflect (learn skills)", interval "daily", schedule_hour 18, schedule_minute 30.
   Prompt: the exact contents of automations/reflect.md from https://github.com/RyanBowie/copilot-autoharness
2. Name "Autoharness · Curate (merge & prune skills)", interval "weekly", schedule_day 0, schedule_hour 19, schedule_minute 0.
   Prompt: the exact contents of automations/curate.md from the same repo.
Then call list_workflows to confirm both exist, and run the Reflect automation once with run_workflow.
```

If the app rejects `host_id: "local"`, ask it to use `user_confirmation: "dialog"` instead. The app will then open the Automation editor pre-filled, and you click **Save**.

You can also create the automations by hand in the **Automations** view. Copy each prompt file's contents into the prompt box.
