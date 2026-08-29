/**
 * Placeholder "ODIN"-style database of realistic tactical doctrine data.
 *
 * This is NOT connected to the real US Army ODIN (OE Data Integration
 * Network) system - it is a simulated stand-in built from publicly
 * available NATO doctrine (e.g. ATP-3.2.1, FM 3-0), open-source historical
 * conflict analysis and OSINT reporting patterns, to be used until real
 * ODIN API credentials are available (see API_INTEGRATIONS.md).
 */
export const doctrineProfiles = [
    {
        id: 'mechanized-infantry',
        name: 'Mechanized/Motorized Infantry Force',
        keywords: ['mechanized', 'motorized', 'bmp', 'btr', 'infantry fighting vehicle', 'ifv', 'apc'],
        composition: 'Motorized rifle battalion built around IFV/APC platoons with organic mortars and ATGM sections.',
        typicalEquipment: ['IFV/APC', '82-120mm mortars', 'ATGM teams', 'towed/self-propelled AT guns'],
        tactics: [
            'Advance in company columns along axes with reconnaissance screen forward',
            'Dismount infantry to clear key terrain while vehicles provide overwatch',
            'Use indirect fire to suppress defensive positions before assault',
            'Attempt to bypass strongpoints and envelop from a flank',
        ],
        counterTactics: [
            'Occupy key terrain with observation of likely axes of advance and engagement areas',
            'Employ anti-armor ambushes at choke points/defiles identified during terrain analysis',
            'Disrupt reconnaissance elements early to blind the enemy advance',
            'Prepare depth positions to defeat envelopment attempts',
        ],
    },
    {
        id: 'light-infantry',
        name: 'Light Infantry / Irregular Force',
        keywords: ['light infantry', 'insurgent', 'guerrilla', 'irregular', 'militia', 'partisan'],
        composition: 'Dismounted infantry sections/squads, often lightly equipped and highly mobile.',
        typicalEquipment: ['small arms', 'RPGs', 'IEDs', 'man-portable mortars', 'technicals'],
        tactics: [
            'Hit-and-run ambushes along routes of movement',
            'Use of IEDs and mines to canalize and attrit forces',
            'Blend with civilian population, exploit restrictive/complex terrain',
            'Harassing indirect fire followed by rapid displacement',
        ],
        counterTactics: [
            'Vary routes and timings; conduct route clearance/counter-IED sweeps',
            'Maintain 360-degree security and overwatch during movement',
            'Use terrain analysis to identify likely ambush sites (chokepoints, dead ground)',
            'Employ population engagement and HUMINT to reduce enemy freedom of movement',
        ],
    },
    {
        id: 'armored',
        name: 'Armored Force',
        keywords: ['armor', 'armour', 'tank', 'armoured', 'main battle tank', 'mbt'],
        composition: 'Tank company/battalion with supporting mechanized infantry and engineers.',
        typicalEquipment: ['main battle tanks', 'AVLBs/engineer vehicles', 'SPAAG/SHORAD'],
        tactics: [
            'Concentrate mass at a point of penetration supported by artillery',
            'Use terrain to mask movement until final assault',
            'Exploit breakthroughs rapidly with follow-on echelons',
        ],
        counterTactics: [
            'Establish engagement areas with obstacles tied to terrain (defiles, restrictive terrain)',
            'Layer anti-armor weapons systems in depth with mutually supporting fields of fire',
            'Request/plan close air support and long-range fires on identified avenues of approach',
        ],
    },
    {
        id: 'artillery',
        name: 'Artillery / Indirect Fire Force',
        keywords: ['artillery', 'mortar', 'rocket artillery', 'mlrs', 'howitzer', 'indirect fire'],
        composition: 'Towed/self-propelled artillery battery or MLRS battery with forward observers.',
        typicalEquipment: ['155mm/152mm howitzers', 'MLRS', 'counter-battery radar'],
        tactics: [
            'Mass fires on identified friendly positions using forward observers/UAS',
            'Shoot-and-scoot to avoid counter-battery fire',
            'Target command posts, logistics and choke points',
        ],
        counterTactics: [
            'Disperse and use camouflage/deception to defeat enemy target acquisition',
            'Use terrain masking (reverse slope positions) identified via terrain analysis',
            'Prioritize counter-battery radar and rapid displacement after contact',
        ],
    },
    {
        id: 'air-defense',
        name: 'Air Defense Force',
        keywords: ['air defense', 'air defence', 'sam', 'manpads', 'anti-air'],
        composition: 'Integrated short/medium-range SAM systems with MANPADS teams.',
        typicalEquipment: ['SHORAD systems', 'MANPADS', 'early warning radar'],
        tactics: [
            'Layer air defense in depth around key assets and lines of advance',
            'Use radar cueing and rapid emplacement/displacement to avoid SEAD',
        ],
        counterTactics: [
            'Plan routes/altitudes using terrain masking from viewshed analysis to reduce exposure',
            'Coordinate SEAD/DEAD prior to any aviation-dependent operation',
        ],
    },
];
/** Match doctrine profiles against free-text extracted from an orders document. */
export function matchDoctrineProfiles(text) {
    const lower = text.toLowerCase();
    return doctrineProfiles.filter((profile) => profile.keywords.some((keyword) => lower.includes(keyword)));
}
