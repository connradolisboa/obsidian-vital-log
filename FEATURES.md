
This file is a plan file for the next features to be implemented in the VitalLog project.

1. Implement a special kind of modal, in this modal, it's the same thing, but instead of showing all the properties I added to the modal, the modal only shows the properties the current note already have. I have the option to select properties that are going to show up in the modal no matter what. We can do just a checkbox in the modal settings to turn on this modal mode. I need a name for this. Mirror Modal?
    1. After implemeting this successfully, I want to be able to set conditional tag/folder setttings to show specific properties all the time depending on the tags of the current note.

2. ~~Implement inline tallies. I want to be able to do something like this (no need to be the same metadata format, just be inline): `tally: name` and the plugin renders inline the tally clicker with the name and counter and up and down buttons and everything.~~ ✅

3. ~~Inline custom counters. Simple feature. Just a inline coutner like `counter: name` but this can be any name, and it's not synced to the tallys in the settings. This will just render a plus and minus buttons and add the value to the current line. like

Fried Chickens:: 0 `counter: Fried Chicken`~~ ✅


4. New feature: timers. Option to add timers to modals, the timers are going to start, and when stopped or paused, they write the time to the note. Timers can also be quickly inlined with `timer: name` or something similar.

5.  ~~Be able to set colors to sections~~ ✅


6. Be able to handle nested properties like the examples below:
````
- property:
    - subproperty: value
    - subproperty: value
- another_property: value
    - subproperty1: value
    - subproperty2:
        - subsubproperty: value
````

Like setting values to be added to another property as nested. Maybe with some toggle in the main modal.

