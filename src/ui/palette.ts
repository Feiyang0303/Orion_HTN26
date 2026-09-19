/** One hue per day of a trip, used on the map pins, the routes and the itinerary
    so a day is recognisable everywhere it appears. Chosen to stay legible over
    photographic rooftops and against the dark glass. */
export const DAY_COLOURS = ['#f0b45e', '#6fd6ff', '#c89bff', '#7fe3a6', '#ff8fa3', '#ffe066', '#8fb8ff']
export const dayColour = (i: number) => DAY_COLOURS[i % DAY_COLOURS.length]
