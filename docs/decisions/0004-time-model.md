# 0004 — Time model

**Status:** Accepted, 2026-10-15 (follows from 0001: any channel, anywhere).

## Decision

- **Store time as integer frame counts**, never floats or strings. Display as `HH:MM:SS:FF`
  (`HH:MM:SS;FF` for drop-frame).
- **Frame rate per channel:** 25, 29.97 drop-frame, 30, 50, 59.94, 24, 23.976.
- **Broadcast day per channel:** a start time (e.g. 06:00). Events after midnight belong to the
  previous broadcast day. The day label is the broadcast day, not the calendar date.
- **Week start per channel** (Aurora Media alone uses Saturday, Friday and Sunday).
- **Time zone: optional, per channel** (IANA name, e.g. `Europe/London`).
  - Set → daylight-saving change days produce 23-hour and 25-hour broadcast days, and the system
    must handle them.
  - Not set → times are literal wall-clock with no conversion (the sample company Aurora Media's
    channels use this).
- **Feeds:** a channel can have time-shifted feeds (+1 h, East / West) derived from its master
  schedule.

## Note

Some channels work timezone-free by design; 9eye supports both models.
