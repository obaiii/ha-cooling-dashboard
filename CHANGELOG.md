# Changelog

## 3.0.0

- Added top-left AC/fan power icons and device dialogs with optional top-right mode buttons.
- Added adjustable per-room night optimisation (20:00-08:00), persistent min/max helpers and a validating save script.
- Gen 60% at minimum; normal/full cooling at maximum with a target 2°C below minimum (floor 16°C). Fan High, Cool, and mapped room fans at 40% oscillating in both stages.
- Added Holiday Mode controls and green/yellow pulses, plus optional 4-hour-on/2-hour-off and Sunday noon reminder blueprints.
- Added optional 45/90/180/350-degree sweep cycling with matching SVG icons and a separate Off button; fan controls stay locked while powered off.
- Added fan model and configurable environmental sensor readings in opened fan cards.
- Added optional solar-surplus cooling with manual priority and a battery-guarded scheduled AC blueprint, both starting at Cool 16°C / High where configured.
- Kept all setup examples generic; HACS installs the card only and automation setup is explicit.
- Corrected missing/boolean power values so they are not displayed as real measured watts.

## 2.0.0

- Renamed the card and package to Cooling Dashboard.
- Card type is now `custom:cooling-dashboard` and the module is `cooling-dashboard.js`.
- Added optional PM2.5 air-quality badges: green for good, orange for moderate and red for poor.
- Added a red/white warning pulse when a fan runs during poor air quality.
- Locked fan speed and oscillation controls while the fan is off so only the power button starts it.

## 1.1.0

- Expanded AC temperature and fan-mode controls.
- Expanded fan speed, power and oscillation controls.
- Blue running-AC pulse and white running-fan pulse.
- Generic screenshots and open-control preview.

## 1.0.0

- Initial public release.
- Responsive climate, fan and weather dashboard.
- Optional humidity, power and AC display controls.
- Running and coldest-room visual indicators.
