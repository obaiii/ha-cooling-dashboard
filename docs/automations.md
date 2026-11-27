# Optional automation setup

No tokens, server addresses or household-specific device IDs are needed by this repository. HACS updates the card; Home Assistant manages the optional automations below.

## Helpers and save script

1. If you use HA packages, copy [helpers-and-scripts.yaml](../examples/helpers-and-scripts.yaml) to `/config/packages/cooling_dashboard.yaml`. Enable packages using `homeassistant: packages: !include_dir_named packages` in your configuration, merging with your existing configuration rather than replacing it. Check configuration before restarting.
2. Alternatively, create the named Toggle, Number and Date/Time helpers in Settings → Devices & services → Helpers, then add the package's `cooling_dashboard_save_optimisation` script through your preferred YAML workflow.
3. Set the example minimum to 23°C and maximum to 25°C once. Helpers intentionally have no `initial` setting, so later values restore after restarts. Keep minimum below maximum, in 0.5°C steps from 16–30°C.
4. Repeat helper groups with different names for each room. Never share min/max or ownership helpers between independent ACs.
5. Add matching optional settings to the card as shown in [dashboard.yaml](../examples/dashboard.yaml).

Do not enable a mode toggle until its blueprint has been configured. Existing installations are not automatically opted in by updating HACS.

## Import blueprints

In Settings → Automations & scenes → Blueprints → Import Blueprint, paste the appropriate URL:

```text
https://github.com/obaiii/ha-cooling-dashboard/blob/main/blueprints/night-cooling-optimisation.yaml
https://github.com/obaiii/ha-cooling-dashboard/blob/main/blueprints/fan-holiday-mode.yaml
https://github.com/obaiii/ha-cooling-dashboard/blob/main/blueprints/holiday-weekly-reminder.yaml
https://github.com/obaiii/ha-cooling-dashboard/blob/main/blueprints/solar-surplus-cooling.yaml
https://github.com/obaiii/ha-cooling-dashboard/blob/main/blueprints/kitchen-daytime-schedule.yaml
```

Create an automation from each blueprint you need and select your own entities. Importing a blueprint alone does not create a running automation. Updates to imported blueprint files also need to be re-imported/reloaded in HA; a HACS card update does not update your automations.

## Night optimisation

This blueprint requires **midea_ac_lan** with the `rate_select` gear attribute. Supply the numeric device ID used by that integration, not HA's device-registry UUID. Other climate integrations still work with the dashboard's basic controls but need their own power-limiting adapter.

For each AC select its enable toggle and minimum/maximum helpers. At the selected minimum, use Gen 60% and the minimum setpoint. At maximum, use unrestricted cooling with a target 2°C below minimum, bounded at 16°C. Between boundaries keep the current stage. Both stages use Cool/High. Mapped room fans run at 40% oscillating in both stages, including when the minimum is reached. Optional Holiday Mode and backup-power helpers suspend the relevant assistance/control.

The routine does not switch on an off AC. At 08:00 it releases the Gen cap for daytime manual use. Turning optimisation off at night releases the cap. The script validates slider values before saving; helper states and values persist. Startup and minute checks reconcile the current time window.

If two ACs share a fan, configure that fan in one coordinating automation or combine their demand; do not let unrelated automations send conflicting fan commands.

## Holiday Mode and reminders

Select a fan, its Holiday toggle and a Date/Time start helper. Enabling starts a fresh cycle: four hours at 50%, two hours off. Disabling stops the fan. Startup calculates the correct phase from the saved timestamp, including time HA was offline.

For compatible Dyson devices, enable maximum sweep to call `dyson_local.set_angle` with 5° and 355° endpoints (a 350° range). Leave that option off for other integrations. The fan must support percentage speed and oscillation. On ten-speed fans, 50% is level 5; other devices may map it differently.

Create one weekly reminder automation for all Holiday toggles. Choose your own phone notification action and set its message to:

```yaml
message: '{{ holiday_message }}'
```

The supplied action receives `holiday_message` and `holiday_count`. It runs at Sunday 12:00 only while at least one mode is enabled. No phone name or notification service is hard-coded.

## Solar-surplus cooling

Create a dedicated enabled toggle, ownership toggle, manual-override toggle, command-grace Date/Time helper and retry-after Date/Time helper for each AC. The package contains a Living Room example group. Select your canonical BMS SOC sensor, not an average of disagreeing inverter estimates.

Provide a **conservative measured headroom sensor in watts**: spare PV after existing loads, conversion losses and any required battery charging. For independent phases, also account for the destination phase. Use the lower of phase and whole-house spare capacity where power cannot be freely shared. Do not substitute daily kWh or a grid-import counter known to duplicate household consumption.

At 100% SOC, daylight and at least 2,500 W headroom for five minutes, the example starts at Cool 16°C, High. Change the headroom budget for your compressor's maximum demand and startup ramp. Optionally add integration-specific actions to clear Eco/Gen/boost limits when starting. Normal climate controls cannot universally release an integration-specific compressor cap.

With shedding enabled, only an AC owned by this automation is stopped after two minutes of shortfall: SOC below 99%, headroom below −300 W, darkness or an inhibit toggle. There is a 15-minute restart cooldown. With shedding disabled, it stays on after starting and can subsequently use battery/grid energy.

Manual on/off or setting changes release ownership and suppress solar control until midnight. HA service commands are detected immediately; physical remote changes are detected through control attributes after a 90-second command-echo grace. Device commands that produce no observable state change cannot be detected. Helpers restore ownership/overrides after restart, but the five/two-minute template qualification timers start again.

This reusable blueprint controls **one AC per instance**, rather than reserving power for a group. If multiple instances share the same headroom, budget for their combined demand or sequence starts with a separate coordinator; it does not atomically reserve watts across independent automations. Sensor freshness/availability must be incorporated into your headroom sensor (report `unavailable` for stale measurements).

At full battery an inverter may curtail PV to match load; it may not expose unused generation potential. The blueprint waits for measured headroom rather than guessing or running trial loads.

## Daytime schedule

Select the scheduled AC, battery SOC sensor and a schedule-enable toggle. At 09:00, or when battery recovers above 35% before 17:00, start an off AC at Cool 16°C. Stop at 17:00 or below 30%. This preserves the scheduled-room policy, including stopping a manually started AC at those limits. Fan mode and announcements can be added separately if desired.

These examples do not alter inverter earthing, battery limits, network settings or any device outside the entities you select.
