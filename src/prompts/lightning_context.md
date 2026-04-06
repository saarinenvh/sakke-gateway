# Lighting System Context

## Overview

The apartment has a layered lighting system with ambient, accent, and directional lights.  
Lighting is designed for atmosphere, not just visibility.

Lights are grouped by purpose and physical zones.

---

## Zones

### living_room_main
- TV area
- Sofa area
- Main ambient lighting

### desk_area
- Workstation and monitors

### cabinet_zone
- Glass cabinet, plants, decorative lights

### hallway
- Entrance area

---

## Light Types

### Ambient Lights (base mood)

- entity_id: light.rgbic_tv_backlight — TV Backlight, strong wall glow behind TV, primary mood driver, RGB
- entity_id: light.wiz_rgbw_tunable_27e72e — Couch Floor Lamp 1, indirect upward light, RGB
- entity_id: light.wiz_rgbw_tunable_24c978 — Couch Floor Lamp 2, indirect upward light, RGB

---

### Accent Lights (depth & atmosphere)

- entity_id: light.rgbicww_floor_lamp — Govee Floor Lamp, vertical LED strip near shelf, RGB
- entity_id: light.uplighter_floor_lamp — Uplighter Floor Lamp, wall accent light, RGB
- entity_id: light.wiz_rgbw_tunable_22b1c8 — Cone Floor Lamp 1, directional near cabinet, RGB
- entity_id: light.wiz_rgbw_tunable_22b05a — Cone Floor Lamp 2, directional near cabinet, RGB
- entity_id: light.wiz_rgbw_tunable_22b520 — Cone Floor Lamp 3, directional near cabinet, RGB
- entity_id: light.hue_play_2 — Hue Play 2, bias lighting behind TV, RGB
- entity_id: light.hue_play_3 — Hue Play 3, bias lighting behind TV, RGB

---

### Decorative Lights (no color)

- entity_id: light.shelf_light — Shelf Light, top of cabinet, brightness only
- entity_id: light.case_lights — Case Lights, inside cabinet, brightness only

---

### Ceiling Lights (functional)

- entity_id: light.wiz_rgbw_tunable_38f16e — Livingroom ceiling 1, main brightness
- entity_id: light.wiz_rgbw_tunable_38e39a — Livingroom ceiling 2, main brightness
- entity_id: light.wiz_rgbw_tunable_38f12c — Livingroom ceiling 3, main brightness
- entity_id: light.wiz_rgbw_tunable_367e46 — Hall, entrance light

---

## Design Rules

- Always prefer indirect lighting
- Combine 2–4 light sources for depth
- Use color contrast (warm vs cold) when possible
- Keep one dominant light source

---

## Capabilities

- Govee lights (rgbicww_floor_lamp, rgbic_tv_backlight, uplighter_floor_lamp) → full RGB + brightness + effects
- Wiz lights (wiz_rgbw_tunable_*) → full RGB + brightness + effects
- Hue lights (hue_play_2, hue_play_3) → full RGB + brightness
- Ikea lights (shelf_light, case_lights) → brightness only, NO color, NO effects

## Available Effects

Use effects purposefully — only when they genuinely enhance the mood. Do not add effects to every light. Pick 1-2 key lights where an effect adds real atmosphere.

Govee effects (rgbicww_floor_lamp, rgbic_tv_backlight, uplighter_floor_lamp):
Fire, Aurora, Ocean, Forest, Meteor, Rainbow, Sunset, Sunrise, Wave, Breathe, Ripple, Party, Halloween, Christmas, Romantic, Dreamlike, Fight, Flash

Wiz effects (wiz_rgbw_tunable_* lights):
Candlelight, Fireplace, Forest, Ocean, Cozy, Romance, Relax, Focus, Daylight, Warm white, Cool white, Pulse, Party, Halloween, Christmas, Sunset, Jungle, Steampunk

---

## Priority Order

1. TV Backlight
2. Ambient floor lighting
3. Accent lights
4. Decorative lights
5. Ceiling lights (last resort)