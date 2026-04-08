# Lighting System Context

## Overview

This apartment has a layered smart lighting setup with ceiling, ambient, accent, decorative, and bias lights.

Each light is mapped to a physical wall using wall references from the room layout context.

### WiZ Effect Speed

WiZ lights have a separate effect speed entity (range 10–200, default ~100).
To set effect speed, include it in the scene output as a separate entry:

```json
{ "entity_id": "number.wiz_couch_floor_lamp_1_effect_speed", "value": 60 }
```

Speed entity IDs follow the pattern: `number.{wiz_entity_base}_effect_speed`

- `number.wiz_couch_floor_lamp_1_effect_speed`
- `number.wiz_couch_floor_lamp_2_effect_speed`
- `number.wiz_cone_floor_lamp_1_effect_speed`
- `number.wiz_cone_floor_lamp_2_effect_speed`
- `number.wiz_cone_floor_lamp_3_effect_speed`

Only include speed entries when using an effect on that light.

---

## Wall Reference

- wall_1_tv = TV wall
- wall_2_window = window wall
- wall_3_sofa_desk = sofa + desk wall
- wall_4_cabinet = cabinet wall

---

## Lights

### Main Ceiling Light

- entity_id: `light.REPLACE_WITH_NEW_HUE_CEILING_ENTITY`
- name: Hue Ceiling Light
- type: ceiling / primary room light
- wall: ceiling_center
- role: main visibility light
- real-world output: very strong
- notes:
  - Brightest light in the apartment
  - Can fully illuminate the room alone
  - White mode is significantly brighter than color
- capabilities:
  - on/off
  - brightness
  - RGB color
  - color temperature

---

## Wall 1 — TV Wall

### Govee Floor Lamp

- entity_id: `light.rgbicww_floor_lamp`
- name: Govee Floor Lamp
- wall: wall_1_tv
- type: vertical ambient lamp
- role: primary mood light on TV wall
- real-world output: medium
- notes:
  - Strong visual wall wash
  - Good for color-driven scenes
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Breathe, Flow, Gradient, Forest, Ocean, Aurora, Fire, Sunrise, Sunset, Meteor, Firefly, Moonlight, Rainbow, Wave, Romantic, Dreamlike, Tunnel

---

### Shelf Case Lights

- entity_id: `light.case_lights`
- name: Case Lights
- wall: wall_1_tv
- type: decorative shelf lighting
- role: small localized accent
- real-world output: very low
- capabilities:
  - on/off
  - brightness

---

### TV Backlight

- entity_id: `light.rgbic_tv_backlight`
- name: TV Backlight
- wall: wall_1_tv
- type: bias light
- role: TV immersion and glow
- real-world output: low-to-medium
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects

---

## Wall 2 — Window Wall

### Window LED Strip

- entity_id: `light.nedis_window_strip`
- name: Window LED Strip
- wall: wall_2_window
- type: ambient strip light
- role: soft background glow
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color

---

## Wall 3 — Sofa + Desk Wall

### Sofa Floor Lamp (2 bulbs)

- entity_id: `light.wiz_couch_floor_lamp_1`
- name: Sofa Floor Lamp (Main)
- wall: wall_3_sofa_desk
- type: uplight / ambient
- role: main ambient support for seating area
- real-world output: medium
- notes:
  - Stronger in white than color
  - Provides ceiling bounce light
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Candlelight, Cozy, Fireplace, Forest, Jungle, Ocean, Romance, Relax, Sunset, Pulse, Party, Rhythm, Deep dive, Pastel colors, Steampunk

---

### Sofa Accent Bulb

- entity_id: `light.wiz_couch_floor_lamp_2`
- name: Sofa Accent Light
- wall: wall_3_sofa_desk
- type: directional accent
- role: highlights wall art
- real-world output: low-to-medium
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Candlelight, Cozy, Fireplace, Forest, Jungle, Ocean, Romance, Relax, Sunset, Pulse, Party, Rhythm, Deep dive, Pastel colors, Steampunk

---

### Desk Hue Lights

- entity_id: `light.hue_play_2`
- name: Desk Hue Light 1
- wall: wall_3_sofa_desk
- type: bias light
- role: monitor backlight
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color
  - color temperature
  - effects (use exact names): candle, fire, prism, sparkle, opal, glisten, underwater, cosmos, sunbeam, enchant, sunrise, sunset

---

- entity_id: `light.hue_play_3`
- name: Desk Hue Light 2
- wall: wall_3_sofa_desk
- type: bias light
- role: monitor backlight
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color
  - color temperature
  - effects (use exact names): candle, fire, prism, sparkle, opal, glisten, underwater, cosmos, sunbeam, enchant, sunrise, sunset

---

### Desk LED Strip

- entity_id: `light.led_strip_light_m1`
- name: Desk LED Strip
- wall: wall_3_sofa_desk
- type: under-desk accent strip
- role: local desk underglow and low-level ambient support
- real-world output: low
- notes:
  - Mounted under the desk
  - Best used as a subtle desk-zone accent, not as a main light
  - Helps separate the desk area from the sofa area
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Breathe, Candlelight, Aurora-A, Aurora-B, Forest, Sunset, Sunrise, Fire-A, Fire-B, Ripple, Wave-A, Moonlight-A, Meteor, Starry Sky, Rainbow-A, Dreamlike-A, Meditation-A, Romantic, Flow-A, Flash, Twinkle-A

### Govee Uplighter

- entity_id: `light.uplighter_floor_lamp`
- name: Govee Uplighter
- wall: wall_3_sofa_desk
- type: dynamic uplight
- role: strong vertical ambient and ceiling wash
- real-world output: medium
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Breathe, Twinkle, Flow, Gradient, Gleam, Forest, Ocean, Aurora, Firefly, Moonlight, Candlelight, Sunrise, Sunset, Bonfire, Stream

---

## Wall 4 — Cabinet Wall

### Cone Floor Lamp (3 heads)

- entity_id: `light.wiz_cone_floor_lamp_1`
- name: Cone Lamp 1
- wall: wall_4_cabinet
- type: directional accent
- role: object highlighting
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Candlelight, Cozy, Fireplace, Forest, Jungle, Ocean, Romance, Relax, Sunset, Pulse, Party, Rhythm, Deep dive, Pastel colors, Steampunk

---

- entity_id: `light.wiz_cone_floor_lamp_2`
- name: Cone Lamp 2
- wall: wall_4_cabinet
- type: directional accent
- role: object highlighting
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Candlelight, Cozy, Fireplace, Forest, Jungle, Ocean, Romance, Relax, Sunset, Pulse, Party, Rhythm, Deep dive, Pastel colors, Steampunk

---

- entity_id: `light.wiz_cone_floor_lamp_3`
- name: Cone Lamp 3
- wall: wall_4_cabinet
- type: directional accent
- role: object highlighting
- real-world output: low
- capabilities:
  - on/off
  - brightness
  - RGB color
  - effects (use exact names): Candlelight, Cozy, Fireplace, Forest, Jungle, Ocean, Romance, Relax, Sunset, Pulse, Party, Rhythm, Deep dive, Pastel colors, Steampunk

---

### Cabinet Shelf Lights

- entity_id: `light.shelf_light`
- name: Cabinet Shelf Lights
- wall: wall_4_cabinet
- type: decorative lighting
- role: depth and subtle structure
- real-world output: low
- capabilities:
  - on/off
  - brightness

---

## Practical Notes

- White light is significantly brighter than RGB
- Ceiling light is the only true full-room illumination source
- Floor lamps provide usable ambient lighting
- TV and bias lights are not sufficient for visibility
- Decorative lights should never be used as primary lighting
- Wall-based lighting creates direction and depth in the room
- Under-desk lighting is a local accent, not a room-lighting source