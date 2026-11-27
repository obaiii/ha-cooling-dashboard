# Cooling Dashboard 3.0.0

Added optional top-right **Optimise Cooling** and **Holiday Mode** buttons to opened device cards, with adjustable min/max sliders, fan air-quality readings and consumer model labels. Fan tiles can cycle 45°, 90°, 180° and 350° sweeps using matching icons while retaining a separate Sweep Off control.

The optional Home Assistant blueprints include night-only Midea optimisation (20:00-08:00), four-hours-on/two-hours-off fan cycling, Sunday noon notifications, 100%-battery solar-surplus cooling with manual priority and a battery-guarded daytime schedule starting at 16°C. Night optimisation keeps mapped fans at 40% oscillating in both cooling stages.

HACS updates the JavaScript card only. Existing users remain opted out of new automation behaviour until they configure the helpers and blueprints. Follow [the automation setup guide](https://github.com/obaiii/ha-cooling-dashboard/blob/main/docs/automations.md) and [example card configuration](https://github.com/obaiii/ha-cooling-dashboard/blob/main/examples/dashboard.yaml).

Validation: seven control tests; Home Assistant schema validation for all five expanded blueprints and the save script; browser checks of slider saving, sweep feedback, Holiday Mode toggling and air-quality dialog; new generic screenshots; private-data/branding scan.
