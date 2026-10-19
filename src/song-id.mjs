export const isLocalSongId = id => /^local-[a-f0-9]{32,64}$/u.test(String(id));
export const isPlayableSongId = id => isLocalSongId(id) || /^[1-9]\d{0,17}$/u.test(String(id));
