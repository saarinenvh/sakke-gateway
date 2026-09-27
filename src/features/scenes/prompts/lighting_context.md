# Lighting System Context

## Overview

This apartment has a layered smart lighting setup consisting of ceiling, ambient, accent, decorative, and bias lighting.

Each light includes:

- physical location
- lighting role
- real-world brightness
- capabilities
- recommended effects

The AI should think like a lighting designer, not a device controller.

---

## WiZ Effect Speed

WiZ lights support configurable animation speed.

When using a WiZ effect, include a separate speed entity:

```json
{
  "entity_id": "number.wiz_couch_floor_lamp_1_effect_speed",
  "value": 60
}
```

Range:

- 10 = very slow
- 100 = default
- 200 = very fast

Only include speed entities when an effect is used.

---

## Wall Reference

- wall_1_tv = TV wall
- wall_2_window = window wall
- wall_3_sofa_desk = sofa + desk wall
- wall_4_cabinet = cabinet wall

---

# Ceiling

## Hue Infuse Ceiling

- entity_id: `light.hue_infuse_ceiling_1`
- wall: ceiling_center
- category: ceiling
- role: primary room illumination
- real-world output: very high

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

- candle
- fire
- prism
- sparkle
- underwater
- cosmos
- sunbeam
- sunrise
- sunset

Notes

- Brightest light in the apartment
- White mode is considerably brighter than RGB
- Usually provides functional visibility

---

# Wall 1 — TV Wall

## Floor Lamp 2 Left

- entity_id: `light.floor_lamp_2_left`
- category: floor uplight
- role: primary cinematic wall wash
- real-world output: medium

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

Nature

- Forest
- Ocean
- Aurora
- Firefly

Fire

- Fire
- Candlelight

Sky

- Sunrise
- Sunset
- Meteor

Ambient

- Gradient
- Breathe
- Dreamlike

Notes

- Positioned left of the TV
- Strong indirect wall illumination

---

## Floor Lamp 2 Right

- entity_id: `light.floor_lamp_2_r`

(same capabilities and effects as left)

Notes

- Positioned right of the TV
- Mirrors the left floor lamp

---

## Smart AI Sync Box

- entity_id: `light.smart_ai_sync_box`
- category: bias light
- role: immersive TV backlight
- real-world output: low-medium

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

Nature

- Forest
- Aurora

Fire

- Fire
- Candlelight

Sky

- Meteor
- Moonlight

Ambient

- Dreamlike
- Flow
- Ripple

Notes

- Behind the TV
- Primary immersion light

---

## Case Lights

- entity_id: `light.case_lights`
- category: decorative
- role: shelf accent
- real-world output: very low

Capabilities

- on/off
- brightness

Notes

- Small decorative light
- Never intended as primary lighting

---

# Wall 2 — Window Wall

## Window LED Strip

- entity_id: `light.nedis_window_strip`

category: strip

role: ambient fill

real-world output: low

Capabilities

- on/off
- brightness
- RGB color

---

## Window Top Light

- entity_id: `light.window_top_light`

category: ceiling strip

role: indirect wall wash

real-world output: medium

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

Nature

- Forest
- Aurora

Sky

- Sunrise
- Sunset
- Meteor
- Moonlight

Ambient

- Breathe
- Dreamlike
- Flow

Notes

- Mounted above the window
- Casts light downward

---

# Wall 3 — Sofa + Desk

## Sofa Floor Lamp

- entity_id: `light.wiz_couch_floor_lamp_1`

category: uplight

role: ambient ceiling bounce

real-world output: medium

Capabilities

- on/off
- brightness
- RGB color

Recommended effects

- Candlelight
- Cozy
- Fireplace
- Forest
- Jungle
- Ocean
- Romance
- Relax
- Sunset
- Deep dive
- Pastel colors
- Steampunk

---

## Sofa Accent Lamp

- entity_id: `light.wiz_couch_floor_lamp_2`

category: uplight

role: wall accent

real-world output: low-to-medium

Capabilities

- on/off
- brightness
- RGB color

Recommended effects

- Candlelight
- Cozy
- Fireplace
- Forest
- Jungle
- Ocean
- Romance
- Relax
- Sunset
- Deep dive
- Pastel colors
- Steampunk

---

## Sofa Strip

- entity_id: `light.sofa_strip_light`

category: LED strip

role: indirect sofa accent

real-world output: low

Capabilities

- on/off
- brightness
- RGB color

Recommended effects

Nature

- Forest
- Aurora

Fire

- Fire
- Candlelight

Ambient

- Dreamlike
- Ripple
- Flow

Notes

- Mounted under the picture shelf
- Shines downward onto the sofa wall

---

## Hue Play 2

- entity_id: `light.hue_play_2`

category: bias light

role: monitor backlight

real-world output: low

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

- candle
- fire
- prism
- underwater
- cosmos
- sparkle
- sunrise
- sunset

---

## Hue Play 3

- entity_id: `light.hue_play_3`

category: bias light

role: monitor backlight

real-world output: low

Capabilities

- on/off
- brightness
- RGB color
- color temperature

Recommended effects

- candle
- fire
- prism
- underwater
- cosmos
- sparkle
- sunrise
- sunset

---

## Desk LED Strip

- entity_id: `light.led_strip_light_m1`

category: LED strip

role: under-desk accent

real-world output: low

Capabilities

- on/off
- brightness
- RGB color

Recommended effects

Nature

- Forest

Fire

- Fire
- Candlelight

Sky

- Meteor
- Moonlight

Ambient

- Dreamlike
- Flow
- Meditation

---

## Desk Govee

- entity_id: `light.desk_govee`

category: floor lamp

role: desk ambient

real-world output: medium

Recommended effects

Nature

- Forest
- Aurora

Fire

- Fire

Sky

- Sunrise
- Sunset
- Meteor

Ambient

- Dreamlike
- Movie
- Cyberpunk
- Thunderstorm

---

## Govee Uplighter

- entity_id: `light.uplighter_floor_lamp`

category: floor uplight

role: vertical ambient lighting

Notes

- Has two light zones but HA only controls the top. Effects control all zones — always use an effect on this light.

Recommended effects

Nature

- Forest
- Ocean
- Aurora

Fire

- Bonfire
- Candlelight

Sky

- Sunrise
- Sunset
- Moonlight

Ambient

- Breathe
- Flow
- Twinkle
- Gradient
- Dreamlike

---

## Table Lamp

- entity_id: `light.table_lamp`

category: decorative

role: cabinet accent

real-world output: very low

Capabilities

- on/off
- brightness
- RGB color

Recommended effects

Nature

- Forest
- Aurora

Fire

- Fire
- Candlelight

Sky

- Meteor
- Moonlight

Ambient

- Dreamland
- Romantic
- Meditation

Notes

- Placed on top of the display cabinet (vitriini) in the center of wall 3
- Small decorative lamp

---

# Wall 4 — Cabinet Wall

## Cone Lamp 1

- entity_id: `light.wiz_cone_floor_lamp_1`

Recommended effects

- Candlelight
- Cozy
- Fireplace
- Forest
- Jungle
- Ocean
- Romance
- Relax
- Sunset
- Deep dive
- Pastel colors
- Steampunk

---

## Cone Lamp 2

- entity_id: `light.wiz_cone_floor_lamp_2`

Recommended effects

- Candlelight
- Cozy
- Fireplace
- Forest
- Jungle
- Ocean
- Romance
- Relax
- Sunset
- Deep dive
- Pastel colors
- Steampunk

---

## Cone Lamp 3

- entity_id: `light.wiz_cone_floor_lamp_3`

Recommended effects

- Candlelight
- Cozy
- Fireplace
- Forest
- Jungle
- Ocean
- Romance
- Relax
- Sunset
- Deep dive
- Pastel colors
- Steampunk

---

## Shelf Lights

- entity_id: `light.shelf_light`

category: decorative

role: cabinet depth

real-world output: very low

Capabilities

- on/off
- brightness

---

# Practical Notes

- White light is significantly brighter than RGB.
- Brightness values are relative to each fixture.
- Decorative lights should never be treated as primary illumination.
- Strong uplights influence multiple walls through indirect reflection.
- Layer lighting using primary, ambient, accent and decorative light.
- Prefer effects only when they meaningfully reinforce the requested atmosphere.