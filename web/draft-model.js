// The same photo order is used in the app, exported preview, and publication.
export function articleBlocks(draft) {
  if (!draft.cover) return draft.blocks;
  const index = draft.blocks.findIndex(block => block.type === 'image' && block.file === draft.cover);
  const cover = index < 0 ? { type:'image', file:draft.cover, alt:`${draft.title} 표지`, caption:'' } : draft.blocks[index];
  return [cover, ...draft.blocks.filter((_, i) => i !== index)];
}

export function manifestImage(manifest, name) {
  return manifest.images.find(image => image.name === name) || manifest.coverImages?.find(image => image.name === name);
}
