const express = require('express');
const router = express.Router();
const {
  listPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  listTracks,
  setPlaylistTracks,
  addTracksToPlaylist,
  removerFaixasPlaylist
} = require('../controllers/playlistController');

router.get('/', listPlaylists);
router.post('/', createPlaylist);
router.put('/:id', updatePlaylist);
router.delete('/:id', deletePlaylist);
router.get('/:playlistId/tracks', listTracks);
router.put('/:playlistId/tracks', setPlaylistTracks);
router.post('/:playlistId/tracks', addTracksToPlaylist);
router.delete('/:playlistId/tracks', removerFaixasPlaylist);

module.exports = router;