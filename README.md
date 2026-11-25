# LCARS Cooling Dashboard

A responsive Home Assistant Lovelace card for air conditioners, fans and weather. It is inspired by an LCARS-style whole-home cooling screen while remaining brand-neutral and safe to share.

## Features

- Climate and fan cards in responsive grids
- Current and target temperature
- Optional humidity and live-power sensors
- Total configured cooling power in the header
- Running AC glow and a faster pulse for the coldest running room
- Animated fan icon while a fan is running
- Optional AC display/LED toggle
- Current outside weather
- Tap any AC or fan card to open Home Assistant's normal controls
- No cloud service, subscription or telemetry

## Install with HACS

1. Open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/obaiii/ha-lcars-cooling-dashboard` as a **Dashboard** repository.
3. Find **LCARS Cooling Dashboard** in HACS and install it.
4. Refresh the browser or fully restart the Home Assistant mobile app.

HACS normally adds the JavaScript resource automatically. If it does not, add this under **Settings → Dashboards → Resources**:

```text
/hacsfiles/ha-lcars-cooling-dashboard/lcars-cooling-dashboard.js
```

Resource type: **JavaScript Module**.

## Add the card

Create a Manual card and start with:

```yaml
type: custom:lcars-cooling-dashboard
title: COOLING SYSTEMS
weather: weather.forecast_home
outside_humidity: sensor.outside_humidity
ac_columns: 3
fan_columns: 3

air_conditioners:
  - entity: climate.living_room
    name: Living Room
    humidity: sensor.living_room_humidity
    power: sensor.living_room_ac_power
    led: switch.living_room_ac_display

  - entity: climate.bedroom
    name: Bedroom
    power_attribute: realtime_power

fans:
  - entity: fan.living_room
    name: Living Room Fan
    humidity: sensor.living_room_fan_humidity
```

Replace every example entity with an entity from your own Home Assistant. A larger example is in [`examples/dashboard.yaml`](examples/dashboard.yaml).

## Configuration

### Main options

| Option | Required | Description |
|---|---:|---|
| `air_conditioners` | No* | List of climate units |
| `fans` | No* | List of fans |
| `weather` | No | Weather entity |
| `outside_humidity` | No | Separate outside-humidity sensor |
| `title` | No | Header text; defaults to `COOLING SYSTEMS` |
| `ac_columns` | No | Desktop AC columns; defaults to 3 |
| `fan_columns` | No | Desktop fan columns; defaults to 3 |
| `show_summary` | No | Show device counts and total power |

*At least one of `air_conditioners` or `fans` must be supplied.

### Per-device options

| Option | Required | Description |
|---|---:|---|
| `entity` | Yes | `climate.*` or `fan.*` entity |
| `name` | No | Display name |
| `humidity` | No | Humidity sensor |
| `power` | No | Power sensor in watts |
| `power_attribute` | No | Climate/fan attribute containing watts |
| `led` | No | Optional switch controlling an AC display light |
| `icon` | No | Optional Material Design icon |

If neither `power` nor `power_attribute` is set, the card also checks the common `compressor_power`, `realtime_power`, and `power` attributes.

## Manual installation

Download `lcars-cooling-dashboard.js`, copy it to `/config/www/`, and add this JavaScript module resource:

```text
/local/lcars-cooling-dashboard.js
```

## Privacy

The repository contains no Home Assistant tokens, URLs, IP addresses or private household entity IDs. All configured entities remain inside the user's own Home Assistant instance.

## License

MIT
