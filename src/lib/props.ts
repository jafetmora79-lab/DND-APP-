export type PropCategory = 'dungeon' | 'furniture' | 'light' | 'nature' | 'storage' | 'traps'

export type PropDef = {
  id: string
  category: PropCategory
  label: string
}

export const PROP_CATEGORY_LABEL: Record<PropCategory, string> = {
  dungeon: 'Dungeon dressing',
  furniture: 'Furniture',
  light: 'Light & ritual',
  nature: 'Nature',
  storage: 'Storage & loot',
  traps: 'Traps & fixtures',
}

/** public/props/<id>.png for every entry. */
export const PROP_CATALOG: PropDef[] = [
  { id: 'dungeon_broken_column', category: 'dungeon', label: 'Broken column' },
  { id: 'dungeon_cobweb_corner', category: 'dungeon', label: 'Cobweb corner' },
  { id: 'dungeon_hooded_statue', category: 'dungeon', label: 'Hooded statue' },
  { id: 'dungeon_rubble_pile', category: 'dungeon', label: 'Rubble pile' },
  { id: 'dungeon_skeleton_remains', category: 'dungeon', label: 'Skeleton remains' },
  { id: 'dungeon_stone_archway', category: 'dungeon', label: 'Stone archway' },
  { id: 'furniture_bed', category: 'furniture', label: 'Bed' },
  { id: 'furniture_bookshelf', category: 'furniture', label: 'Bookshelf' },
  { id: 'furniture_chair', category: 'furniture', label: 'Chair' },
  { id: 'furniture_dresser', category: 'furniture', label: 'Dresser' },
  { id: 'furniture_mirror', category: 'furniture', label: 'Mirror' },
  { id: 'furniture_nightstand', category: 'furniture', label: 'Nightstand' },
  { id: 'light_altar', category: 'light', label: 'Altar' },
  { id: 'light_brazier', category: 'light', label: 'Brazier' },
  { id: 'light_candelabra', category: 'light', label: 'Candelabra' },
  { id: 'light_chandelier', category: 'light', label: 'Chandelier' },
  { id: 'light_pentagram_rug', category: 'light', label: 'Ritual circle' },
  { id: 'light_wall_sconce', category: 'light', label: 'Wall sconce' },
  { id: 'nature_bush', category: 'nature', label: 'Bush' },
  { id: 'nature_dead_tree', category: 'nature', label: 'Dead tree' },
  { id: 'nature_firepit', category: 'nature', label: 'Firepit' },
  { id: 'nature_mossy_boulder', category: 'nature', label: 'Mossy boulder' },
  { id: 'nature_tent', category: 'nature', label: 'Tent' },
  { id: 'nature_tree_stump', category: 'nature', label: 'Tree stump' },
  { id: 'storage_barrel', category: 'storage', label: 'Barrel' },
  { id: 'storage_barrel_chest', category: 'storage', label: 'Chest' },
  { id: 'storage_coin_sack', category: 'storage', label: 'Coin sack' },
  { id: 'storage_crate', category: 'storage', label: 'Crate' },
  { id: 'storage_rope_coil', category: 'storage', label: 'Rope coil' },
  { id: 'storage_treasure_chest_open', category: 'storage', label: 'Open treasure chest' },
  { id: 'traps_cauldron', category: 'traps', label: 'Cauldron' },
  { id: 'traps_locked_door', category: 'traps', label: 'Locked door' },
  { id: 'traps_pressure_plate', category: 'traps', label: 'Pressure plate' },
  { id: 'traps_spike_pit', category: 'traps', label: 'Spike pit' },
  { id: 'traps_wall_lever', category: 'traps', label: 'Wall lever' },
  { id: 'traps_well', category: 'traps', label: 'Well' },
]

const PROP_BY_ID = new Map(PROP_CATALOG.map((p) => [p.id, p]))

export function propDef(id: string): PropDef | undefined {
  return PROP_BY_ID.get(id)
}
