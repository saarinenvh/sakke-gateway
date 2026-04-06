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

- TV Backlight (Govee) — entity_id: light.rgbic_tv_backlight
  - Strong wall glow behind TV
  - Primary mood driver
  - Supports full RGB

- Couch Floor Lamp 1 (Wiz) — entity_id: light.wiz_rgbw_tunable_27e72e
  - Indirect upward light
  - Soft room fill

- Couch Floor Lamp 2 (Wiz) — entity_id: light.wiz_rgbw_tunable_24c978
  - Indirect upward light
  - Soft room fill

---

### Accent Lights (depth & atmosphere)

- Govee Floor Lamp — entity_id: light.rgbicww_floor_lamp
  - Vertical LED strip near shelf
  - Adds depth and color accents

- Uplighter Floor Lamp (Govee) — entity_id: light.uplighter_floor_lamp
  - Directional + indirect hybrid
  - Can light walls and create effects

- Cone Floor Lamp 1 (Wiz) — entity_id: light.wiz_rgbw_tunable_22b1c8
  - Directional warm light near cabinet

- Cone Floor Lamp 2 (Wiz) — entity_id: light.wiz_rgbw_tunable_22b05a
  - Directional warm light near cabinet

- Cone Floor Lamp 3 (Wiz) — entity_id: light.wiz_rgbw_tunable_22b520
  - Directional warm light near cabinet

- Hue Play 2 — entity_id: light.hue_play_2
  - Bias lighting, RGB

- Hue Play 3 — entity_id: light.hue_play_3
  - Bias lighting, RGB

---

### Decorative Lights (static / non-RGB)

- Shelf Light (Ikea) — entity_id: light.shelf_light
  - Top of cabinet, warm, no color

- Case Lights (Ikea) — entity_id: light.case_lights
  - Inside cabinet, subtle highlights, no color

---

### Ceiling Lights (functional)

- Livingroom ceiling 1 (Wiz) — entity_id: light.wiz_rgbw_tunable_38f16e
  - Main brightness, OFF in mood scenes

- Livingroom ceiling 2 (Wiz) — entity_id: light.wiz_rgbw_tunable_38e39a
  - Main brightness, OFF in mood scenes

- Livingroom ceiling 3 (Wiz) — entity_id: light.wiz_rgbw_tunable_38f12c
  - Main brightness, OFF in mood scenes

- Hall (Wiz) — entity_id: light.wiz_rgbw_tunable_367e46
  - Entrance light

---

## Design Rules

- Avoid ceiling lights in atmospheric scenes
- Always prefer indirect lighting
- Combine 2–4 light sources for depth
- Use color contrast (warm vs cold) when possible
- Keep one dominant light source

---

## Capabilities

- Govee lights (rgbicww_floor_lamp, rgbic_tv_backlight, uplighter_floor_lamp) → full RGB + brightness
- Wiz lights (wiz_rgbw_tunable_*) → full RGB + brightness
- Hue lights (hue_play_2, hue_play_3) → full RGB + brightness
- Ikea lights (shelf_light, case_lights) → brightness only, NO color

---

## Priority Order

1. TV Backlight
2. Ambient floor lighting
3. Accent lights
4. Decorative lights
5. Ceiling lights (last resort)