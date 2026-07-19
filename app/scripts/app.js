(function () {
  "use strict";

  var KEY = {
    ENTER: 13,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    BACK: 461,
    ESC: 27,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    PAGE_UP: 33,
    PAGE_DOWN: 34,
    MEDIA_NEXT: 176,
    MEDIA_PREV: 177
  };

  var API = {
    ITUNES_SEARCH: "https://itunes.apple.com/search",
    APPLE_TOP_MUSIC: "https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json",
    AUDIUS: "https://discoveryprovider.audius.co/v1",
    JAMENDO_TRACKS: "https://api.jamendo.com/v3.0/tracks/",
    YOUTUBE_SEARCH: "https://www.googleapis.com/youtube/v3/search",
    ARCHIVE_SEARCH: "https://archive.org/advancedsearch.php",
    ARCHIVE_METADATA: "https://archive.org/metadata/",
    TVMAZE_SEARCH: "https://api.tvmaze.com/search/shows",
    TVMAZE_SHOWS: "https://api.tvmaze.com/shows?page=1"
  };

  var STORAGE = {
    SAVED: "medianest.saved.v2",
    RECENT: "medianest.recent.v2"
  };

  var state = {
    section: "home",
    filter: "all",
    focusIndex: 0,
    overlayOpen: false,
    detailOpen: false,
    detailItem: null,
    currentMedia: null,
    recommended: [],
    searchResults: [],
    saved: [],
    recent: [],
    catalogPage: 0,
    searchTimer: null,
    toastTimer: null
    ,cleanupTimer: null
    ,lastProgressWrite: 0
    ,youtubeTime: 0
    ,youtubeDuration: 0
    ,youtubeState: -1
  };

  var sectionCopy = {
    home: ["Recomendado para ti", "Peliculas abiertas, cortos y musica"],
    movies: ["Peliculas y cortometrajes", "Seleccion abierta lista para reproducir"],
    series: ["Series de prueba", "Temporadas cortas con episodios funcionales"],
    music: ["Musica", "Audio completo y videos musicales abiertos"],
    search: ["Buscar", "Escribe para buscar como en un catalogo de streaming"],
    space: ["Mi espacio", "Favoritos guardados localmente en esta TV"]
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function requestJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    });
  }

  function readStore(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || "[]");
    } catch (err) {
      return [];
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value.slice(0, 30)));
    } catch (err) {
      showToast("Almacenamiento local lleno");
    }
  }

  function normalizeArtwork(url, size) {
    if (!url) {
      return "";
    }
    return url.replace(/100x100bb/g, size + "x" + size + "bb").replace(/60x60bb/g, size + "x" + size + "bb");
  }

  function stripTags(html) {
    var div = document.createElement("div");
    div.innerHTML = html || "";
    return div.textContent || div.innerText || "";
  }

  function safeText(text) {
    return String(text || "").replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function normalizeSearch(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[^a-z0-9áéíóúüñ ]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function uniqueMusicQueries(term) {
    var clean = normalizeSearch(term);
    var noFeaturing = clean
      .replace(/\b(ft|feat|featuring|con|x|&)\b/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
    var parts = noFeaturing.split(" ");
    var queries = [];
    var seen = {};
    var i;

    function add(value) {
      value = normalizeSearch(value);
      if (value.length >= 2 && !seen[value]) {
        seen[value] = true;
        queries.push(value);
      }
    }

    add(clean);
    add(noFeaturing);

    if (parts.length > 2) {
      add(parts.slice(0, Math.ceil(parts.length / 2)).join(" "));
      add(parts.slice(Math.floor(parts.length / 2)).join(" "));
    }

    for (i = 0; i < parts.length; i += 1) {
      if (parts[i].length > 3) {
        add(parts[i]);
        if (parts[i].charAt(parts[i].length - 1) === "s") {
          add(parts[i].slice(0, -1));
        } else {
          add(parts[i] + "s");
        }
      }
    }

    return queries.slice(0, 6);
  }

  function isRemixLike(text) {
    return /\b(remix|edit|bootleg|sped up|slowed|nightcore|cover|karaoke|instrumental|flip|mashup|rework|mix|version|dj set|reaction|lyrics?)\b/i.test(text || "");
  }

  function scoreMusicResult(item, query) {
    var q = normalizeSearch(query);
    var title = normalizeSearch(item.title);
    var meta = normalizeSearch(item.meta);
    var qWords = q.split(" ");
    var combined = title + " " + meta;
    var score = 0;
    var i;

    if (!q) {
      return 0;
    }
    if (title === q) {
      score += 120;
    }
    if (title.indexOf(q) !== -1) {
      score += 80;
    }
    if (q.indexOf(title) !== -1) {
      score += 35;
    }
    if (meta.indexOf(q) !== -1) {
      score += 20;
    }
    for (i = 0; i < qWords.length; i += 1) {
      if (qWords[i].length > 2 && combined.indexOf(qWords[i]) !== -1) {
        score += 10;
      }
    }
    if (isRemixLike(item.title)) {
      score -= 45;
    }
    if (isRemixLike(item.meta)) {
      score -= 20;
    }
    if (/official|vevo|topic/i.test((item.title || "") + " " + (item.meta || ""))) {
      score += 30;
    }
    return score;
  }

  function sortMusicResults(items, query) {
    return items.sort(function (a, b) {
      return scoreMusicResult(b, query) - scoreMusicResult(a, query);
    });
  }

  function formatTime(seconds) {
    var total = Math.max(0, Math.floor(seconds || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;

    if (hours > 0) {
      return hours + ":" + (minutes < 10 ? "0" : "") + minutes + ":" + (secs < 10 ? "0" : "") + secs;
    }
    return minutes + ":" + (secs < 10 ? "0" : "") + secs;
  }

  function itemMatchesFilter(item) {
    return state.filter === "all" || item.type === state.filter;
  }

  function itemId(item) {
    return item.id || (item.type + ":" + item.title);
  }

  function isSaved(id) {
    var i;
    for (i = 0; i < state.saved.length; i += 1) {
      if (itemId(state.saved[i]) === id) {
        return true;
      }
    }
    return false;
  }

  function removeSaved(id) {
    var output = [];
    var i;
    for (i = 0; i < state.saved.length; i += 1) {
      if (itemId(state.saved[i]) !== id) {
        output.push(state.saved[i]);
      }
    }
    state.saved = output;
    writeStore(STORAGE.SAVED, state.saved);
    renderRows();
  }

  function upsertItem(list, item) {
    var id = itemId(item);
    var output = [item];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (itemId(list[i]) !== id) {
        output.push(list[i]);
      }
    }
    return output;
  }

  function mapItunesItem(raw, forcedType) {
    var type = forcedType || "movies";
    var title = raw.trackName || raw.collectionName || raw.artistName || "Sin titulo";
    var meta = raw.primaryGenreName || raw.kind || "Catalogo online";
    var preview = raw.previewUrl || "";
    var mediaType = type === "music" ? "audio" : "video";

    return {
      id: "itunes:" + (raw.trackId || raw.collectionId || title),
      title: title,
      type: type,
      kind: type === "music" ? "Musica" : type === "series" ? "Serie" : "Pelicula",
      meta: preview ? meta + " | preview online" : meta + " | ficha online",
      source: preview,
      mediaType: mediaType,
      image: normalizeArtwork(raw.artworkUrl100 || raw.artworkUrl60, 400),
      provider: "Apple Search API",
      progress: 0
    };
  }

  function mapTopMovie(raw) {
    return {
      id: "topmovie:" + raw.id,
      title: raw.name || "Pelicula popular",
      type: "movies",
      kind: "Pelicula",
      meta: (raw.genres && raw.genres[0] ? raw.genres[0].name : "Top online") + " | popular ahora",
      source: "",
      mediaType: "video",
      image: raw.artworkUrl100 ? normalizeArtwork(raw.artworkUrl100, 400) : "",
      provider: "Apple RSS",
      progress: 0
    };
  }

  function mapAppleMusic(raw) {
    return {
      id: "applemusic:" + raw.id,
      title: raw.name || "Cancion popular",
      type: "music",
      kind: "Musica",
      meta: (raw.artistName || "Apple Music") + " | popular ahora",
      source: "",
      mediaType: "audio",
      image: normalizeArtwork(raw.artworkUrl100, 400),
      provider: "Apple RSS",
      progress: 0
    };
  }

  function audiusImage(track) {
    if (track.artwork) {
      return track.artwork["480x480"] || track.artwork["1000x1000"] || track.artwork["150x150"] || "";
    }
    if (track.user && track.user.profile_picture) {
      return track.user.profile_picture["480x480"] || track.user.profile_picture["1000x1000"] || track.user.profile_picture["150x150"] || "";
    }
    return "";
  }

  function mapAudiusTrack(track) {
    var artist = track.user && track.user.name ? track.user.name : "Audius";
    return {
      id: "audius:" + track.id,
      title: track.title || "Cancion",
      type: "music",
      kind: "Musica",
      meta: artist + " | cancion completa",
      source: API.AUDIUS + "/tracks/" + encodeURIComponent(track.id) + "/stream?app_name=MediaNest",
      mediaType: "audio",
      image: audiusImage(track),
      provider: "Audius",
      progress: 0
    };
  }

  function jamendoClientId() {
    return window.MediaNestConfig && window.MediaNestConfig.jamendoClientId ? window.MediaNestConfig.jamendoClientId : "";
  }

  function youtubeApiKey() {
    return window.MediaNestConfig && window.MediaNestConfig.youtubeApiKey ? window.MediaNestConfig.youtubeApiKey : "";
  }

  function youtubePlayerUrl() {
    return window.MediaNestConfig && window.MediaNestConfig.youtubePlayerUrl ? window.MediaNestConfig.youtubePlayerUrl : "";
  }

  function mapYouTubeVideo(raw) {
    var snippet = raw.snippet || {};
    var videoId = raw.id && raw.id.videoId ? raw.id.videoId : "";
    var thumbnails = snippet.thumbnails || {};
    var image = thumbnails.high || thumbnails.medium || thumbnails.default || {};
    return {
      id: "youtube:" + videoId,
      videoId: videoId,
      title: decodeHtml(snippet.title || "Video musical"),
      type: "music",
      kind: "Musica",
      meta: decodeHtml((snippet.channelTitle || "YouTube") + " | video completo"),
      source: youtubePlayerUrl() ? youtubePlayerUrl() + "?v=" + encodeURIComponent(videoId) : "",
      mediaType: "youtube",
      image: image.url || "",
      provider: "YouTube",
      progress: 0
    };
  }

  function decodeHtml(value) {
    var node = document.createElement("textarea");
    node.innerHTML = value;
    return node.value;
  }

  function youtubeMusicSearch(term, rows) {
    var key = youtubeApiKey();
    var query = (term || "").replace(/^\s+|\s+$/g, "");
    var url;
    if (!key || !youtubePlayerUrl() || query.length < 2) {
      return Promise.resolve([]);
    }
    url = API.YOUTUBE_SEARCH + "?part=snippet&type=video&videoCategoryId=10&videoEmbeddable=true&safeSearch=moderate" +
      "&maxResults=" + Math.min(rows || 25, 50) + "&order=relevance&q=" + encodeURIComponent(query) +
      "&key=" + encodeURIComponent(key);
    return requestJson(url).then(function (payload) {
      var items = (payload.items || []).map(mapYouTubeVideo).filter(function (item) {
        return item.videoId && !isRemixLike(item.title + " " + item.meta);
      });
      return sortMusicResults(items, query);
    }).catch(function () {
      return [];
    });
  }

  function mapJamendoTrack(track) {
    return {
      id: "jamendo:" + track.id,
      title: track.name || "Cancion",
      type: "music",
      kind: "Musica",
      meta: (track.artist_name || "Jamendo") + " | cancion completa",
      source: track.audio || "",
      mediaType: "audio",
      image: track.album_image || track.image || "",
      provider: "Jamendo",
      progress: 0
    };
  }

  function jamendoSearch(term, rows, popular) {
    var clientId = jamendoClientId();
    var url;

    if (!clientId) {
      return Promise.resolve([]);
    }

    url = API.JAMENDO_TRACKS +
      "?client_id=" + encodeURIComponent(clientId) +
      "&format=json&audioformat=mp32&imagesize=400&limit=" + (rows || 20) +
      "&include=musicinfo&order=" + (popular ? "popularity_total" : "relevance") +
      (term ? "&search=" + encodeURIComponent(term) : "");

    return requestJson(url).then(function (payload) {
      return (payload.results || []).map(mapJamendoTrack).filter(function (item) {
        return item.source && !isRemixLike(item.title + " " + item.meta);
      });
    }).catch(function () {
      return [];
    });
  }


  function mapTvMazeResult(raw) {
    var show = raw.show || raw;
    return {
      id: "tvmaze:" + show.id,
      title: show.name || "Serie",
      type: "series",
      kind: "Serie",
      meta: (show.genres && show.genres.length ? show.genres.slice(0, 2).join(", ") : "TVMaze") + " | ficha online",
      source: "",
      mediaType: "video",
      image: show.image ? (show.image.medium || show.image.original || "") : "",
      provider: "TVMaze",
      summary: stripTags(show.summary),
      progress: 0
    };
  }

  function stremioCatalogUrl() {
    var configured = window.MediaNestConfig && window.MediaNestConfig.stremioCatalogUrl;
    return String(configured || "https://v3-cinemeta.strem.io").replace(/\/manifest\.json\/?$/i, "").replace(/\/$/, "");
  }

  function stremioStreamAddonUrls() {
    var configured = window.MediaNestConfig && window.MediaNestConfig.stremioStreamAddonUrls;
    var urls = configured && configured.length ? configured : [];
    return urls.map(function (url) {
      return String(url || "").replace(/\/manifest\.json\/?$/i, "").replace(/\/$/, "");
    }).filter(function (url) {
      return /^https:\/\//i.test(url);
    });
  }

  function stremioServiceUrl() {
    var configured = window.MediaNestConfig && window.MediaNestConfig.stremioServiceUrl;
    return String(configured || "").replace(/\/$/, "");
  }

  function startStremioTorrent(item, stream) {
    var service = stremioServiceUrl();
    var hash = String(stream.infoHash || "").toLowerCase();
    if (!service || !hash) {
      renderRows();
      showToast("Configura Stremio Service para reproducir este resultado");
      return Promise.resolve();
    }
    showToast("Preparando video con Stremio Service");
    return fetch(service + "/" + encodeURIComponent(hash) + "/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guessFileIdx: true })
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    }).then(function (stats) {
      var fileIndex = Number(stream.fileIdx);
      if (isNaN(fileIndex)) {
        fileIndex = Number(stats.guessedFileIdx);
      }
      if (isNaN(fileIndex)) {
        fileIndex = 0;
      }
      item.source = service + "/" + encodeURIComponent(hash) + "/" + fileIndex;
      item.meta = (item.meta || "Stremio") + " | Stremio Service";
      openPlayer(item);
    }).catch(function () {
      renderRows();
      showToast("No se pudo conectar con Stremio Service");
    });
  }

  function mapStremioMeta(raw, forcedType) {
    var stremioType = forcedType || raw.type || "movie";
    var year = raw.releaseInfo || raw.year || "";
    var genres = raw.genres && raw.genres.length ? raw.genres.slice(0, 2).join(", ") : "Stremio";
    return {
      id: "stremio:" + stremioType + ":" + raw.id,
      stremioId: raw.id,
      stremioType: stremioType,
      title: raw.name || raw.title || "Sin titulo",
      type: stremioType === "series" ? "series" : "movies",
      kind: stremioType === "series" ? "Serie" : "Pelicula",
      meta: genres + (year ? " | " + year : "") + " | Stremio",
      source: "",
      mediaType: "video",
      image: raw.poster || raw.background || "",
      provider: "Stremio / Cinemeta",
      summary: raw.description || "",
      progress: 0
    };
  }

  function stremioCatalog(type, term, rows, skip) {
    var extra = term ? "search=" + encodeURIComponent(term) : "skip=" + (skip || 0);
    var url = stremioCatalogUrl() + "/catalog/" + type + "/top/" + extra + ".json";
    return requestJson(url).then(function (payload) {
      return (payload.metas || []).slice(0, rows || 50).map(function (meta) {
        return mapStremioMeta(meta, type);
      });
    }).catch(function () {
      return [];
    });
  }

  function stremioPlayableMovieCatalog(term, rows, skip) {
    var configured = window.MediaNestConfig && window.MediaNestConfig.stremioMovieCatalogUrl;
    var catalogId = window.MediaNestConfig && window.MediaNestConfig.stremioMovieCatalogId;
    var base = String(configured || "").replace(/\/manifest\.json\/?$/i, "").replace(/\/$/, "");
    var extra = term ? "/search=" + encodeURIComponent(term) : (skip ? "/skip=" + skip : "");
    var url;
    if (!base || !catalogId) {
      return Promise.resolve([]);
    }
    url = base + "/catalog/movie/" + encodeURIComponent(catalogId) + extra + ".json";
    return requestJson(url).then(function (payload) {
      return (payload.metas || []).slice(0, rows || 50).map(function (meta) {
        var item = mapStremioMeta(meta, "movie");
        item.kind = "Pelicula completa";
        item.meta = "Stremio | disponible para reproducir";
        item.provider = "Stremio / Public Domain Movies";
        return item;
      });
    }).catch(function () {
      return [];
    });
  }

  function mapStremioEpisode(video, seriesItem) {
    var season = Number(video.season) || 0;
    var episode = Number(video.episode) || 0;
    var label = season && episode ? "T" + season + " E" + episode : "Episodio";
    return {
      id: "stremio:episode:" + video.id,
      stremioId: video.id,
      stremioType: "series",
      title: label + " - " + (video.title || seriesItem.title),
      type: "series",
      kind: "Episodio",
      meta: seriesItem.title + (video.released ? " | " + String(video.released).slice(0, 4) : ""),
      source: "",
      mediaType: "video",
      image: video.thumbnail || seriesItem.image || "",
      provider: "Stremio / Cinemeta",
      progress: 0
    };
  }

  function loadStremioEpisodes(item) {
    var url = stremioCatalogUrl() + "/meta/series/" + encodeURIComponent(item.stremioId) + ".json";
    byId("catalogRow").innerHTML = '<div class="status-card">Cargando episodios de "' + safeText(item.title) + '"...</div>';
    return requestJson(url).then(function (payload) {
      var videos = payload.meta && payload.meta.videos ? payload.meta.videos : [];
      state.searchResults = videos.map(function (video) {
        return mapStremioEpisode(video, item);
      });
      state.filter = "series";
      state.catalogPage = 0;
      setSection("search");
      byId("sectionTitle").innerHTML = safeText(item.title);
      byId("sectionHint").innerHTML = state.searchResults.length + " episodios encontrados en Stremio";
      showToast(state.searchResults.length ? "Selecciona un episodio" : "No hay episodios disponibles");
    }).catch(function () {
      showToast("Stremio no pudo cargar los episodios");
      renderRows();
    });
  }

  function resolveStremioStream(item) {
    var addons = stremioStreamAddonUrls();
    var torrentStream = null;
    var jobs;
    if (!addons.length) {
      showToast("Configura un complemento Stremio de streaming");
      return Promise.resolve();
    }
    byId("catalogRow").innerHTML = '<div class="status-card">Buscando reproduccion autorizada en Stremio...</div>';
    jobs = addons.map(function (base) {
      var url = base + "/stream/" + item.stremioType + "/" + encodeURIComponent(item.stremioId) + ".json";
      return requestJson(url).then(function (payload) {
        return payload.streams || [];
      }).catch(function () {
        return [];
      });
    });
    return Promise.all(jobs).then(function (lists) {
      var directUrl = "";
      var i;
      var j;
      for (i = 0; i < lists.length; i += 1) {
        for (j = 0; j < lists[i].length; j += 1) {
          if (/^https?:\/\//i.test(lists[i][j].url || "")) {
            directUrl = lists[i][j].url;
            break;
          }
          if (!torrentStream && lists[i][j].infoHash) {
            torrentStream = lists[i][j];
          }
        }
        if (directUrl) { break; }
      }
      if (directUrl) {
        item.source = directUrl;
        openPlayer(item);
      } else if (torrentStream) {
        startStremioTorrent(item, torrentStream);
      } else {
        renderRows();
        showToast("No hay stream directo autorizado disponible");
      }
    });
  }

  function openStremioItem(item) {
    if (item.stremioType === "series" && item.kind !== "Episodio") {
      loadStremioEpisodes(item);
      return;
    }
    resolveStremioStream(item);
  }

  function fallbackItems() {
    return (window.MediaNestData || []).map(function (item) {
      return {
        id: item.id,
        title: item.title,
        type: item.section === "music" ? "music" : item.section === "series" ? "series" : "movies",
        kind: item.kind,
        meta: item.meta,
        source: item.source,
        mediaType: item.mediaType,
        image: item.image || "",
        backdrop: item.backdrop || item.image || "",
        provider: "Catalogo abierto",
        progress: item.progress || 0,
        year: item.year || "",
        durationText: item.durationText || "",
        rating: item.rating || "",
        genres: item.genres || "",
        description: item.description || "",
        episodes: item.episodes || []
      };
    });
  }

  function encodeArchivePath(name) {
    return name.split("/").map(function (part) {
      return encodeURIComponent(part);
    }).join("/");
  }

  function archiveFileUrl(identifier, fileName) {
    return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodeArchivePath(fileName);
  }

  function archiveImageUrl(identifier) {
    return "https://archive.org/services/img/" + encodeURIComponent(identifier);
  }

  function pickArchiveFile(files, wantAudio) {
    // webOS 4.x is most reliable with MP4/H.264, so prefer it over archive masters.
    var videoTypes = ["h.264", "mpeg4", "512kb mpeg4", "webm", "ogv"];
    var audioTypes = ["vbr mp3", "mp3", "ogg vorbis"];
    var types = wantAudio ? audioTypes : videoTypes;
    var i;
    var j;
    var fmt;

    for (i = 0; i < files.length; i += 1) {
      fmt = (files[i].format || "").toLowerCase();
      if (!files[i].name) {
        continue;
      }
      for (j = 0; j < types.length; j += 1) {
        if (fmt.indexOf(types[j]) !== -1) {
          return files[i];
        }
      }
    }
    return null;
  }

  function archiveCollections(metadata) {
    var collection = metadata.metadata ? metadata.metadata.collection : [];
    if (!collection) {
      return [];
    }
    return typeof collection === "string" ? [collection] : collection;
  }

  function hasOpenArchiveRights(metadata) {
    var info = metadata.metadata || {};
    var license = (info.licenseurl || "").toLowerCase();
    var rights = (info.rights || "").toLowerCase();
    var collections = archiveCollections(metadata).join(" ").toLowerCase();

    if (license.indexOf("creativecommons.org") !== -1 || license.indexOf("publicdomain") !== -1 || license.indexOf("public-domain") !== -1) {
      return true;
    }
    if (rights.indexOf("public domain") !== -1 || rights.indexOf("creative commons") !== -1 || rights.indexOf("cc0") !== -1) {
      return true;
    }
    if (collections.indexOf("feature_films") !== -1 || collections.indexOf("classic_tv") !== -1 || collections.indexOf("television") !== -1 || collections.indexOf("publicdomain") !== -1 || collections.indexOf("opensource_audio") !== -1 || collections.indexOf("netlabels") !== -1 || collections.indexOf("etree") !== -1) {
      return true;
    }
    return false;
  }

  function mapArchiveMetadata(doc, metadata, type) {
    var isMusicVideo = type === "music-video";
    var wantAudio = type === "music";
    var file = pickArchiveFile(metadata.files || [], wantAudio);
    var info = metadata.metadata || {};
    var title = info.title || doc.title || doc.identifier;
    var description = stripTags(typeof info.description === "string" ? info.description : (info.description && info.description[0]) || "");
    var subjects = info.subject || [];
    var year = info.year || info.date || "";
    var runtime = info.runtime || "";
    var safetyText = (title + " " + subjects + " " + description).toLowerCase();

    if (typeof subjects === "string") {
      subjects = subjects.split(";");
    }
    year = String(year).match(/\d{4}/) ? String(year).match(/\d{4}/)[0] : "Clasico";
    runtime = String(runtime || "").replace(/^00:/, "");

    if (!file || !hasOpenArchiveRights(metadata) || /\b(porn|erotic|nudist|molester|sexploitation)\b/i.test(safetyText)) {
      return null;
    }

    return {
      id: "archive:" + doc.identifier,
      title: title,
      type: isMusicVideo ? "music" : type,
      kind: isMusicVideo ? "Video musical" : type === "music" ? "Audio completo" : type === "series" ? "Episodio completo" : "Pelicula completa",
      meta: "Internet Archive | completo y reproducible",
      source: archiveFileUrl(doc.identifier, file.name),
      mediaType: wantAudio ? "audio" : "video",
      image: archiveImageUrl(doc.identifier),
      backdrop: archiveImageUrl(doc.identifier),
      provider: "Internet Archive",
      progress: 0,
      year: year,
      durationText: runtime || (type === "series" ? "Episodio" : "Largometraje"),
      rating: "Dominio publico",
      genres: subjects.slice(0, 2).join(", ") || (type === "series" ? "Television clasica" : "Cine clasico"),
      description: description || "Titulo clasico conservado y disponible para reproduccion desde Internet Archive."
    };
  }

  function mapArchiveDocsInBatches(docs, type) {
    var output = [];
    var index = 0;

    function nextBatch() {
      var batch = docs.slice(index, index + 5);
      var jobs;
      var i;
      index += batch.length;
      jobs = [];
      for (i = 0; i < batch.length; i += 1) {
        jobs.push(requestJson(API.ARCHIVE_METADATA + encodeURIComponent(batch[i].identifier)).then((function (doc) {
          return function (metadata) {
            return mapArchiveMetadata(doc, metadata, type);
          };
        }(batch[i]))).catch(function () {
          return null;
        }));
      }
      return Promise.all(jobs).then(function (items) {
        var j;
        for (j = 0; j < items.length; j += 1) {
          if (items[j]) {
            output.push(items[j]);
          }
        }
        return index < docs.length ? nextBatch() : output;
      });
    }

    return docs.length ? nextBatch() : Promise.resolve([]);
  }

  function archiveSearch(term, type, rows, popular) {
    var mediaType = type === "music" ? "audio" : "movies";
    var query;
    var url;

    if (popular && type === "movies") {
      query = "collection:(feature_films) AND mediatype:(movies)";
    } else if (popular && type === "series") {
      query = 'mediatype:(movies) AND (collection:(classic_tv) OR subject:("classic tv") OR subject:("television series"))';
    } else if (popular && type === "music") {
      query = 'mediatype:(audio) AND (collection:(opensource_audio) OR collection:(netlabels) OR collection:(etree)) AND (licenseurl:(creativecommons.org*) OR rights:(public domain) OR rights:("Creative Commons"))';
    } else {
      if (type === "music") {
        query = '(title:("' + term.replace(/"/g, "") + '") OR creator:("' + term.replace(/"/g, "") + '") OR description:("' + term.replace(/"/g, "") + '")) AND mediatype:(audio) AND (collection:(opensource_audio) OR collection:(netlabels) OR collection:(etree) OR licenseurl:(creativecommons.org*))';
      } else if (type === "series") {
        query = '(title:("' + term.replace(/"/g, "") + '") OR description:("' + term.replace(/"/g, "") + '")) AND mediatype:(movies) AND (collection:(classic_tv) OR subject:("classic tv") OR subject:("television series") OR subject:(episode))';
      } else {
        query = '(title:("' + term.replace(/"/g, "") + '") OR description:("' + term.replace(/"/g, "") + '")) AND mediatype:(' + mediaType + ')';
      }
    }

    url = API.ARCHIVE_SEARCH + "?q=" + encodeURIComponent(query) +
      "&fl[]=identifier&fl[]=title&fl[]=year&rows=" + (rows || 8) + "&page=1&output=json&sort[]=downloads%20desc";

    return requestJson(url).then(function (payload) {
      var docs = payload.response && payload.response.docs ? payload.response.docs : [];
      return mapArchiveDocsInBatches(docs, type);
    }).catch(function () {
      return [];
    });
  }

  function archiveMusicVideoSearch(term, rows, popular) {
    var clean = term ? term.replace(/"/g, "") : "";
    var query;
    var url;

    if (popular) {
      query = 'mediatype:(movies) AND (subject:(music) OR subject:(concert) OR subject:("music video"))';
    } else {
      query = '(title:("' + clean + '") OR description:("' + clean + '")) AND mediatype:(movies) AND (subject:(music) OR subject:(concert) OR subject:("music video") OR title:("music video"))';
    }

    url = API.ARCHIVE_SEARCH + "?q=" + encodeURIComponent(query) +
      "&fl[]=identifier&fl[]=title&rows=" + (rows || 6) + "&page=1&output=json&sort[]=downloads%20desc";

    return requestJson(url).then(function (payload) {
      var docs = payload.response && payload.response.docs ? payload.response.docs : [];
      var jobs = [];
      var i;
      for (i = 0; i < docs.length; i += 1) {
        jobs.push(requestJson(API.ARCHIVE_METADATA + encodeURIComponent(docs[i].identifier)).then((function (doc) {
          return function (metadata) {
            return mapArchiveMetadata(doc, metadata, "music-video");
          };
        }(docs[i]))).catch(function () {
          return null;
        }));
      }
      return Promise.all(jobs).then(function (items) {
        var out = [];
        var j;
        for (j = 0; j < items.length; j += 1) {
          if (items[j]) {
            out.push(items[j]);
          }
        }
        return out;
      });
    }).catch(function () {
      return [];
    });
  }

  function fullMusicSearch(term, rows, popular) {
    var url;
    var queries;
    var jobs;
    if (popular) {
      if (youtubeApiKey() && term) {
        return youtubeMusicSearch(term, rows || 15);
      }
      if (jamendoClientId()) {
        return jamendoSearch("", rows || 15, true);
      }
      url = API.AUDIUS + "/tracks/trending?app_name=MediaNest&limit=" + (rows || 10);
      return requestJson(url).then(function (payload) {
        return (payload.data || []).map(mapAudiusTrack).filter(function (item) {
          return !isRemixLike(item.title + " " + item.meta);
        });
      }).catch(function () {
        return Promise.all([
          archiveSearch(term || "", "music", rows || 8, !!popular),
          archiveMusicVideoSearch(term || "", rows || 6, !!popular)
        ]).then(mergeUnique);
      });
    }

    if (youtubeApiKey()) {
      return youtubeMusicSearch(term || "", rows || 30).then(function (items) {
        return items.length ? items : audiusMusicSearch(term || "", rows || 20);
      });
    }

    if (jamendoClientId()) {
      return jamendoSearch(term || "", rows || 25, false).then(function (items) {
        if (items.length) {
          return sortMusicResults(items, term || "");
        }
        return [];
      });
    }

    queries = uniqueMusicQueries(term || "");
    jobs = queries.map(function (query) {
      return requestJson(API.AUDIUS + "/tracks/search?query=" + encodeURIComponent(query) + "&app_name=MediaNest&limit=" + (rows || 25)).then(function (payload) {
        return (payload.data || []).map(mapAudiusTrack).filter(function (item) {
          return !isRemixLike(item.title + " " + item.meta);
        });
      }).catch(function () {
        return [];
      });
    });

    return Promise.all(jobs).then(function (lists) {
      var merged = mergeUnique(lists);
      if (merged.length) {
        return sortMusicResults(merged, term || "");
      }
      return Promise.all([
        archiveSearch(term || "", "music", rows || 12, false),
        archiveMusicVideoSearch(term || "", rows || 8, false)
      ]).then(function (fallbackLists) {
        return sortMusicResults(mergeUnique(fallbackLists), term || "");
      });
    });
  }

  function audiusMusicSearch(term, rows) {
    var queries = uniqueMusicQueries(term || "");
    var jobs = queries.map(function (query) {
      return requestJson(API.AUDIUS + "/tracks/search?query=" + encodeURIComponent(query) + "&app_name=MediaNest&limit=" + (rows || 10)).then(function (payload) {
        return (payload.data || []).map(mapAudiusTrack).filter(function (item) {
          return !isRemixLike(item.title + " " + item.meta);
        });
      }).catch(function () {
        return [];
      });
    });

    return Promise.all(jobs).then(function (lists) {
      return sortMusicResults(mergeUnique(lists), term || "");
    });
  }

  function getFocusables() {
    var scope = state.overlayOpen ? byId("playerOverlay") : state.detailOpen ? byId("detailOverlay") : byId("app");
    var nodes = scope.querySelectorAll(".focusable");
    var visible = [];
    var i;

    for (i = 0; i < nodes.length; i += 1) {
      if (nodes[i].offsetParent !== null && !nodes[i].disabled) {
        visible.push(nodes[i]);
      }
    }

    return visible;
  }

  function setFocus(index) {
    var items = getFocusables();
    var i;

    if (!items.length) {
      return;
    }

    if (index < 0) {
      index = 0;
    }
    if (index >= items.length) {
      index = items.length - 1;
    }

    for (i = 0; i < items.length; i += 1) {
      items[i].className = items[i].className.replace(/\bis-focused\b/g, "").replace(/\s+/g, " ");
    }

    items[index].className += " is-focused";
    state.focusIndex = index;

    if (items[index].tagName && items[index].tagName.toLowerCase() === "input") {
      items[index].focus();
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  function moveFocus(direction) {
    var items = getFocusables();
    var current = items[state.focusIndex];
    var currentRect;
    var bestIndex = state.focusIndex;
    var bestScore = Infinity;
    var i;
    var rect;
    var dx;
    var dy;
    var score;

    if (!current) {
      setFocus(0);
      return;
    }

    currentRect = current.getBoundingClientRect();

    for (i = 0; i < items.length; i += 1) {
      if (i === state.focusIndex) {
        continue;
      }

      rect = items[i].getBoundingClientRect();
      dx = (rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2);
      dy = (rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2);

      if (direction === "left" && dx >= -8) { continue; }
      if (direction === "right" && dx <= 8) { continue; }
      if (direction === "up" && dy >= -8) { continue; }
      if (direction === "down" && dy <= 8) { continue; }

      score = direction === "left" || direction === "right"
        ? Math.abs(dx) + Math.abs(dy) * 3
        : Math.abs(dy) + Math.abs(dx) * 2;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    setFocus(bestIndex);
  }

  function setFilter(filter) {
    var chips = document.querySelectorAll(".filter-chip");
    var i;
    state.filter = filter;
    state.catalogPage = 0;
    for (i = 0; i < chips.length; i += 1) {
      chips[i].className = chips[i].className.replace(/\bis-active\b/g, "").replace(/\s+/g, " ");
      if (chips[i].getAttribute("data-filter") === filter) {
        chips[i].className += " is-active";
      }
    }
    renderRows();
  }

  function setSection(section) {
    var navItems = document.querySelectorAll(".nav-item");
    var i;
    state.section = section;
    state.catalogPage = 0;

    for (i = 0; i < navItems.length; i += 1) {
      navItems[i].className = navItems[i].className.replace(/\bis-active\b/g, "").replace(/\s+/g, " ");
      if (navItems[i].getAttribute("data-section") === section) {
        navItems[i].className += " is-active";
      }
    }

    if (section === "movies") { setFilter("movies"); }
    if (section === "series") { setFilter("series"); }
    if (section === "music") { setFilter("music"); }
    if (section === "home" || section === "space") { setFilter("all"); }

    renderRows();
    setFocus(section === "search" ? 6 : 0);
  }

  function createCard(item) {
    var id = itemId(item);
    var img = item.image ? '<img class="card-image" src="' + safeText(item.image) + '" alt="">' : '<div class="card-image card-placeholder">' + safeText(item.kind || "Media") + '</div>';
    var playable = item.source ? "Reproducible" : "Ficha";

    return '' +
      '<button class="focusable media-card media-card-' + safeText(item.type) + '" data-action="open-media" data-id="' + safeText(id) + '">' +
        img +
        '<span class="media-kind">' + safeText(item.kind || playable) + '</span>' +
        '<span class="media-title">' + safeText(item.title) + '</span>' +
        '<span class="media-meta">' + safeText(item.meta || playable) + '</span>' +
      '</button>';
  }

  function filteredItems(items) {
    var output = [];
    var i;

    for (i = 0; i < items.length; i += 1) {
      if (itemMatchesFilter(items[i])) {
        output.push(items[i]);
      }
    }

    return output;
  }

  function setPageButtons(total, pageSize) {
    var prev = byId("prevPageButton");
    var next = byId("nextPageButton");
    var pages = Math.max(1, Math.ceil(total / pageSize));
    var hasPages = pages > 1;

    prev.className = prev.className.replace(/\bis-hidden\b/g, "").replace(/\s+/g, " ");
    next.className = next.className.replace(/\bis-hidden\b/g, "").replace(/\s+/g, " ");

    if (!hasPages) {
      prev.className += " is-hidden";
      next.className += " is-hidden";
      return;
    }

    prev.disabled = state.catalogPage <= 0;
    next.disabled = state.catalogPage >= pages - 1;
    prev.innerHTML = "Anterior";
    next.innerHTML = "Siguiente " + (state.catalogPage + 1) + "/" + pages;
  }

  function renderCardRow(container, items, emptyMessage, maxItems, page) {
    var html = "";
    var shown = 0;
    var filtered = filteredItems(items);
    var start;
    var i;
    maxItems = maxItems || 5;
    page = page || 0;
    start = page * maxItems;

    for (i = start; i < filtered.length && shown < maxItems; i += 1) {
      html += createCard(filtered[i]);
      shown += 1;
    }

    if (!html) {
      if ((state.section === "music" || state.filter === "music") && !youtubeApiKey() && !jamendoClientId()) {
        html = '<div class="status-card">Agrega youtubeApiKey en scripts/config.js para buscar videos musicales oficiales.</div>';
      } else {
        html = '<div class="status-card">' + safeText(emptyMessage) + '</div>';
      }
    }

    container.innerHTML = html;
    return filtered.length;
  }

  function getVisibleItems() {
    if (state.section === "space") {
      return state.saved;
    }
    if (state.section === "search") {
      return state.searchResults;
    }
    if (state.section === "movies") {
      return state.recommended.filter(function (item) { return item.type === "movies"; });
    }
    if (state.section === "series") {
      return state.recommended.filter(function (item) { return item.type === "series"; });
    }
    if (state.section === "music") {
      return state.recommended.filter(function (item) { return item.type === "music"; });
    }
    return state.recommended;
  }

  function renderRows() {
    var copy = sectionCopy[state.section] || sectionCopy.home;
    var maxCatalog = state.section === "home" ? 5 : 10;
    var totalCatalog;
    var pages;
    byId("sectionTitle").innerHTML = copy[0];
    byId("sectionHint").innerHTML = copy[1];
    byId("continueHint").innerHTML = state.recent.length ? "Guardado automaticamente en esta TV" : "Aparecera aqui cuando reproduzcas algo";

    renderCardRow(byId("continueRow"), state.recent, "Todavia no has reproducido nada.", 5);
    totalCatalog = filteredItems(getVisibleItems()).length;
    pages = Math.max(1, Math.ceil(totalCatalog / maxCatalog));
    if (state.catalogPage >= pages) {
      state.catalogPage = pages - 1;
    }
    totalCatalog = renderCardRow(byId("catalogRow"), getVisibleItems(), state.section === "space" ? "No has guardado favoritos." : "No hay resultados para este filtro.", maxCatalog, state.catalogPage);
    setPageButtons(totalCatalog, maxCatalog);
  }

  function showToast(message) {
    var toast = byId("toast");
    toast.innerHTML = safeText(message);
    toast.className = "toast is-visible";
    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
    }
    state.toastTimer = window.setTimeout(function () {
      toast.className = "toast";
    }, 1800);
  }

  function findItem(id) {
    var pools = [state.recommended, state.searchResults, state.saved, state.recent];
    var i;
    var j;
    for (i = 0; i < pools.length; i += 1) {
      for (j = 0; j < pools[i].length; j += 1) {
        if (itemId(pools[i][j]) === id) {
          return pools[i][j];
        }
      }
    }
    return null;
  }

  function saveItem(item) {
    state.saved = upsertItem(state.saved, item);
    writeStore(STORAGE.SAVED, state.saved);
    renderRows();
    showToast("Guardado en Mi espacio");
  }

  function updateSaveButton() {
    var button = document.querySelector('[data-action="save-current"]');
    if (!button || !state.currentMedia) {
      return;
    }
    button.innerHTML = isSaved(itemId(state.currentMedia)) ? "Eliminar" : "Guardar";
  }

  function updateDetailSaveButton() {
    var button = byId("detailSaveButton");
    if (button && state.detailItem) {
      button.innerHTML = isSaved(itemId(state.detailItem)) ? "Eliminar de Mi espacio" : "Guardar en Mi espacio";
    }
  }

  function episodeItem(parent, episode, index) {
    return {
      id: episode.id || parent.id + ":episode:" + index,
      title: parent.title + " - " + (episode.title || "Episodio " + (index + 1)),
      type: "series",
      kind: "Episodio",
      meta: episode.durationText || parent.meta,
      source: episode.source || "",
      mediaType: "video",
      image: episode.image || parent.image || "",
      backdrop: episode.image || parent.backdrop || "",
      description: episode.description || parent.description || "",
      progress: 0
    };
  }

  function openDetail(item) {
    var episodes = item.episodes || [];
    var html = "";
    var i;
    state.detailItem = item;
    state.detailOpen = true;
    byId("detailKind").innerHTML = safeText(item.kind || (item.type === "series" ? "Serie" : "Pelicula"));
    byId("detailTitle").innerHTML = safeText(item.title);
    byId("detailMeta").innerHTML = safeText([item.year, item.rating, item.durationText, item.genres].filter(function (value) { return !!value; }).join("  |  "));
    byId("detailDescription").innerHTML = safeText(item.description || "Contenido abierto disponible para reproducir en MediaNest.");
    byId("detailBackdrop").style.backgroundImage = item.backdrop || item.image ? "url('" + String(item.backdrop || item.image).replace(/'/g, "%27") + "')" : "";
    if (episodes.length) {
      for (i = 0; i < episodes.length; i += 1) {
        html += '<button class="focusable episode-card" data-action="detail-episode" data-episode="' + i + '">' +
          (episodes[i].image ? '<img src="' + safeText(episodes[i].image) + '" alt="">' : '') +
          '<span class="episode-copy"><strong>' + safeText(episodes[i].title || "Episodio " + (i + 1)) + '</strong><small>' + safeText(episodes[i].durationText || "") + '</small><em>' + safeText(episodes[i].description || "") + '</em></span></button>';
      }
      byId("episodeRow").innerHTML = html;
      byId("episodeArea").className = "episode-area";
    } else {
      byId("episodeRow").innerHTML = "";
      byId("episodeArea").className = "episode-area is-hidden";
    }
    byId("detailOverlay").className = "detail-overlay";
    updateDetailSaveButton();
    setFocus(0);
  }

  function closeDetail() {
    state.detailOpen = false;
    state.detailItem = null;
    byId("detailOverlay").className = "detail-overlay is-hidden";
    setFocus(0);
  }

  function playDetailItem(item) {
    var playable = item;
    if (item.episodes && item.episodes.length) {
      playable = episodeItem(item, item.episodes[0], 0);
    }
    closeDetail();
    openPlayer(playable);
  }

  function updatePlayButton() {
    var button = document.querySelector('[data-action="toggle-play"]');
    var player = getPlayer();
    if (!button) {
      return;
    }
    if (state.currentMedia && state.currentMedia.mediaType === "youtube") {
      button.innerHTML = state.youtubeState === 1 ? "Pausa" : "Play";
      return;
    }
    if (!player) {
      button.innerHTML = "Play";
      return;
    }
    button.innerHTML = player.paused ? "Play" : "Pausa";
  }

  function updateTimeLabels() {
    var player = getPlayer();
    if (state.currentMedia && state.currentMedia.mediaType === "youtube") {
      byId("currentTimeLabel").innerHTML = formatTime(state.youtubeTime);
      byId("durationLabel").innerHTML = state.youtubeDuration ? formatTime(state.youtubeDuration) : "0:00";
      return;
    }
    if (!player) {
      byId("currentTimeLabel").innerHTML = "0:00";
      byId("durationLabel").innerHTML = "0:00";
      return;
    }
    byId("currentTimeLabel").innerHTML = formatTime(player.currentTime);
    byId("durationLabel").innerHTML = player.duration && !isNaN(player.duration) ? formatTime(player.duration) : "0:00";
  }

  function addRecent(item) {
    var copy = {};
    var key;
    for (key in item) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        copy[key] = item[key];
      }
    }
    copy.lastPlayed = Date.now();
    state.recent = upsertItem(state.recent, copy);
    writeStore(STORAGE.RECENT, state.recent);
    if (!state.overlayOpen) {
      renderRows();
    }
  }

  function persistCurrentProgress(force) {
    var now = Date.now();
    var player;
    var pct = 0;

    if (!state.currentMedia) {
      return;
    }
    if (state.currentMedia.mediaType === "youtube") {
      return;
    }
    if (!force && now - state.lastProgressWrite < 8000) {
      return;
    }

    player = getPlayer();
    if (player && player.duration && !isNaN(player.duration)) {
      pct = Math.max(0, Math.min(100, (player.currentTime / player.duration) * 100));
      state.currentMedia.progress = Math.round(pct);
      state.currentMedia.lastPosition = player.currentTime || 0;
    }

    state.lastProgressWrite = now;
    state.recent = upsertItem(state.recent, state.currentMedia);
    writeStore(STORAGE.RECENT, state.recent);
  }

  function getPlayer() {
    if (state.currentMedia && state.currentMedia.mediaType === "youtube") {
      return null;
    }
    return state.currentMedia && state.currentMedia.mediaType === "audio" ? byId("audioPlayer") : byId("videoPlayer");
  }

  function sendYouTubeCommand(command, extra) {
    var frame = byId("youtubePlayer");
    var payload = extra || {};
    payload.source = "medianest";
    payload.command = command;
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(payload, "*");
    }
  }

  function stopPlayers() {
    var video = byId("videoPlayer");
    var audio = byId("audioPlayer");
    var youtube = byId("youtubePlayer");
    try { video.pause(); } catch (err1) {}
    try { audio.pause(); } catch (err2) {}
    try { sendYouTubeCommand("pause"); } catch (err3) {}
    video.removeAttribute("src");
    audio.removeAttribute("src");
    try { video.load(); } catch (err4) {}
    try { audio.load(); } catch (err5) {}
    youtube.className = "media-player is-hidden";
    youtube.removeAttribute("src");
    state.youtubeTime = 0;
    state.youtubeDuration = 0;
    state.youtubeState = -1;
    state.lastProgressWrite = 0;
  }

  function setPlayerMode(mediaType, item) {
    var video = byId("videoPlayer");
    var youtube = byId("youtubePlayer");
    var audioArt = byId("audioArt");
    youtube.className = mediaType === "youtube" ? "media-player" : "media-player is-hidden";
    if (mediaType === "audio") {
      video.className = "media-player is-hidden";
      audioArt.className = "audio-art";
      audioArt.innerHTML = safeText(item && item.title ? item.title : "MediaNest");
      if (item && item.image) {
        audioArt.style.backgroundImage = "linear-gradient(0deg, rgba(2, 6, 23, 0.58), rgba(2, 6, 23, 0.18)), url('" + item.image.replace(/'/g, "%27") + "')";
      } else {
        audioArt.style.backgroundImage = "";
      }
    } else if (mediaType === "youtube") {
      video.className = "media-player is-hidden";
      audioArt.className = "audio-art is-hidden";
      audioArt.style.backgroundImage = "";
    } else {
      video.className = "media-player";
      audioArt.className = "audio-art is-hidden";
      audioArt.style.backgroundImage = "";
    }
  }

  function openPlayer(item) {
    var player;
    if (!item) {
      return;
    }
    if (!item.source) {
      showToast("Este resultado es una ficha online; no trae preview reproducible.");
      return;
    }

    stopPlayers();
    if (state.cleanupTimer) {
      window.clearTimeout(state.cleanupTimer);
      state.cleanupTimer = null;
    }
    state.currentMedia = item;
    setPlayerMode(item.mediaType, item);

    state.overlayOpen = true;
    byId("playerTitle").innerHTML = safeText(item.title);
    byId("playerOverlay").className = "player-overlay";
    byId("progressBar").style.width = (item.progress || 0) + "%";
    updateTimeLabels();
    addRecent(item);
    updateSaveButton();
    setFocus(0);

    if (item.mediaType === "youtube") {
      state.youtubeTime = 0;
      state.youtubeDuration = 0;
      state.youtubeState = -1;
      byId("youtubePlayer").src = item.source;
      updatePlayButton();
      showToast("Cargando video dentro de MediaNest");
      return;
    }

    player = getPlayer();
    player.src = item.source;
    player.currentTime = item.lastPosition || 0;
    player.volume = 0.9;

    player.play().then(function () {
      updatePlayButton();
      showToast("Reproduciendo: " + item.title);
    }).catch(function () {
      updatePlayButton();
      showToast("Presiona OK para reproducir");
    });
  }

  function closePlayer() {
    var closingMedia = state.currentMedia;
    if (!closingMedia || closingMedia.mediaType !== "youtube") {
      persistCurrentProgress(true);
    }
    state.overlayOpen = false;
    byId("playerOverlay").className = "player-overlay is-hidden";
    updateTimeLabels();
    updatePlayButton();
    setFocus(0);
    if (closingMedia && closingMedia.mediaType === "youtube") {
      sendYouTubeCommand("pause");
    }
    if (state.cleanupTimer) {
      window.clearTimeout(state.cleanupTimer);
    }
    state.cleanupTimer = window.setTimeout(function () {
      stopPlayers();
      state.currentMedia = null;
      state.cleanupTimer = null;
      updateTimeLabels();
      updatePlayButton();
    }, 600);
  }

  function updateProgress() {
    var player = getPlayer();
    var pct = 0;
    var item;

    if (state.currentMedia && state.currentMedia.mediaType === "youtube") {
      updateTimeLabels();
      return;
    }
    if (!player) {
      return;
    }

    if (player && player.duration && !isNaN(player.duration)) {
      pct = Math.max(0, Math.min(100, (player.currentTime / player.duration) * 100));
    }

    byId("progressBar").style.width = pct + "%";
    updateTimeLabels();
    persistCurrentProgress(false);
  }

  function togglePlay() {
    var player = getPlayer();
    if (state.overlayOpen && state.currentMedia && state.currentMedia.mediaType === "youtube") {
      sendYouTubeCommand(state.youtubeState === 1 ? "pause" : "play");
      return;
    }
    if (!state.overlayOpen || !player) {
      return;
    }
    if (player.paused) {
      player.play();
      updatePlayButton();
      showToast("Reproducir");
    } else {
      player.pause();
      updatePlayButton();
      showToast("Pausa");
    }
  }

  function seekBy(seconds) {
    var player = getPlayer();
    if (state.overlayOpen && state.currentMedia && state.currentMedia.mediaType === "youtube") {
      sendYouTubeCommand("seekRelative", { seconds: seconds });
      return;
    }
    if (!state.overlayOpen || !player || !player.duration) {
      return;
    }
    player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + seconds));
    updateProgress();
    updatePlayButton();
  }

  function itunesSearch(term, type) {
    var media = type === "music" ? "music" : type === "series" ? "tvShow" : "movie";
    var entity = type === "music" ? "song" : type === "series" ? "tvEpisode" : "movie";
    var url = API.ITUNES_SEARCH + "?term=" + encodeURIComponent(term) + "&media=" + encodeURIComponent(media) + "&entity=" + encodeURIComponent(entity) + "&limit=8";
    return requestJson(url).then(function (payload) {
      return (payload.results || []).map(function (raw) {
        return mapItunesItem(raw, type);
      });
    }).catch(function () {
      return [];
    });
  }

  function tvmazeSearch(term) {
    return requestJson(API.TVMAZE_SEARCH + "?q=" + encodeURIComponent(term)).then(function (payload) {
      return (payload || []).map(mapTvMazeResult);
    }).catch(function () {
      return [];
    });
  }

  function mergeUnique(lists) {
    var out = [];
    var seen = {};
    var i;
    var j;
    var id;
    for (i = 0; i < lists.length; i += 1) {
      for (j = 0; j < lists[i].length; j += 1) {
        id = itemId(lists[i][j]);
        if (!seen[id]) {
          seen[id] = true;
          out.push(lists[i][j]);
        }
      }
    }
    return out;
  }

  function searchOnline() {
    var term = (byId("searchInput").value || "").replace(/^\s+|\s+$/g, "");
    var jobs = [];
    var filter = state.filter;

    if (term.length < 2) {
      state.searchResults = [];
      state.catalogPage = 0;
      if (state.section === "search") {
        renderRows();
      }
      return;
    }

    state.section = "search";
    state.catalogPage = 0;

    if (filter === "all" || filter === "movies" || filter === "series") {
      jobs.push(Promise.resolve(fallbackItems().filter(function (item) {
        var haystack = normalizeSearch(item.title + " " + item.kind + " " + item.genres + " " + item.description);
        return (filter === "all" || item.type === filter) && haystack.indexOf(normalizeSearch(term)) !== -1 && item.type !== "music";
      })));
    }
    if (filter === "all" || filter === "movies") {
      jobs.push(archiveSearch(term, "movies", 24, false));
    }
    if (filter === "all" || filter === "series") {
      jobs.push(archiveSearch(term, "series", 24, false));
    }
    if (filter === "all" || filter === "music") {
      jobs.push(fullMusicSearch(term, 50, false));
    }

    byId("sectionTitle").innerHTML = "Buscando";
    byId("sectionHint").innerHTML = "Consultando APIs online...";
    byId("catalogRow").innerHTML = '<div class="status-card">Buscando "' + safeText(term) + '"...</div>';

    Promise.all(jobs).then(function (lists) {
      state.searchResults = mergeUnique(lists);
      setSection("search");
      showToast(state.searchResults.length ? "Resultados actualizados" : "Sin resultados");
    }).catch(function () {
      showToast("No se pudo buscar online");
    });
  }

  function scheduleSearch() {
    if (state.searchTimer) {
      window.clearTimeout(state.searchTimer);
    }
    state.searchTimer = window.setTimeout(searchOnline, 900);
  }

  function loadRecommendations() {
    var baseItems = fallbackItems();
    state.recommended = baseItems;
    updateHero();
    renderRows();

    Promise.all([
      archiveSearch("", "movies", 30, true),
      archiveSearch("", "series", 30, true)
    ]).then(function (lists) {
      state.recommended = mergeUnique([baseItems, lists[0], lists[1]]);
      updateHero();
      renderRows();
    }).catch(function () {
      showToast("El catalogo abierto no pudo actualizarse");
    });

    fullMusicSearch("", 8, true).then(function (musicItems) {
      state.recommended = mergeUnique([state.recommended, musicItems]);
      updateHero();
      renderRows();
    }).catch(function () {
      return [];
    });
  }

  function updateHero() {
    var item = state.recommended[0] || fallbackItems()[0];
    byId("heroMediaTitle").innerHTML = safeText(item ? item.title : "MediaNest");
    if (item && item.image) {
      byId("heroImage").src = item.image;
      byId("heroImage").className = "hero-image";
    } else {
      byId("heroImage").removeAttribute("src");
      byId("heroImage").className = "hero-image is-hidden";
    }
  }

  function activateCurrent() {
    var items = getFocusables();
    var el = items[state.focusIndex];
    var action;
    var item;

    if (!el) {
      return;
    }

    action = el.getAttribute("data-action");

    if (action === "section") {
      setSection(el.getAttribute("data-section"));
    } else if (action === "filter-type") {
      setFilter(el.getAttribute("data-filter"));
    } else if (action === "search-online" || action === "search-input") {
      searchOnline();
    } else if (action === "page-prev") {
      if (state.catalogPage > 0) {
        state.catalogPage -= 1;
        renderRows();
        setFocus(Math.max(0, state.focusIndex - 1));
      }
    } else if (action === "page-next") {
      state.catalogPage += 1;
      renderRows();
      setFocus(Math.max(0, state.focusIndex - 1));
    } else if (action === "open-media") {
      item = findItem(el.getAttribute("data-id"));
      if (item && item.type !== "music") {
        openDetail(item);
      } else if (item && item.stremioId) {
        openStremioItem(item);
      } else {
        openPlayer(item);
      }
    } else if (action === "detail-play") {
      if (state.detailItem) {
        playDetailItem(state.detailItem);
      }
    } else if (action === "detail-episode") {
      if (state.detailItem) {
        item = episodeItem(state.detailItem, state.detailItem.episodes[Number(el.getAttribute("data-episode"))], Number(el.getAttribute("data-episode")));
        closeDetail();
        openPlayer(item);
      }
    } else if (action === "detail-save") {
      if (state.detailItem) {
        if (isSaved(itemId(state.detailItem))) {
          removeSaved(itemId(state.detailItem));
          showToast("Eliminado de Mi espacio");
        } else {
          saveItem(state.detailItem);
        }
        updateDetailSaveButton();
      }
    } else if (action === "detail-close") {
      closeDetail();
    } else if (action === "save-current") {
      if (state.currentMedia) {
        if (isSaved(itemId(state.currentMedia))) {
          removeSaved(itemId(state.currentMedia));
          showToast("Eliminado de Mi espacio");
        } else {
          saveItem(state.currentMedia);
        }
        updateSaveButton();
      }
    } else if (action === "toggle-play") {
      togglePlay();
    } else if (action === "rewind") {
      seekBy(-10);
    } else if (action === "forward") {
      seekBy(30);
    } else if (action === "close-player") {
      closePlayer();
    }
  }

  function onKeyDown(event) {
    var code = event.keyCode || event.which;

    if (document.activeElement === byId("searchInput") && code !== KEY.ENTER && code !== KEY.UP && code !== KEY.DOWN && code !== KEY.LEFT && code !== KEY.RIGHT && code !== KEY.BACK && code !== KEY.ESC) {
      window.setTimeout(scheduleSearch, 0);
      return;
    }

    if (code === KEY.LEFT) {
      moveFocus("left");
    } else if (code === KEY.RIGHT) {
      moveFocus("right");
    } else if (code === KEY.UP) {
      moveFocus("up");
    } else if (code === KEY.DOWN) {
      moveFocus("down");
    } else if (code === KEY.ENTER) {
      activateCurrent();
    } else if (code === KEY.BACK || code === KEY.ESC) {
      if (state.overlayOpen) {
        closePlayer();
      } else if (state.detailOpen) {
        closeDetail();
      } else {
        showToast("BACK: volver o salir");
      }
    } else if (code === KEY.PLAY || code === KEY.PAUSE) {
      togglePlay();
    } else if (code === KEY.STOP) {
      if (state.overlayOpen) {
        closePlayer();
      }
    } else if (code === KEY.REWIND || code === KEY.MEDIA_PREV || code === KEY.PAGE_DOWN) {
      seekBy(-10);
    } else if (code === KEY.FAST_FORWARD || code === KEY.MEDIA_NEXT || code === KEY.PAGE_UP) {
      seekBy(30);
    } else {
      return;
    }

    event.preventDefault();
  }

  function bindEvents() {
    var video = byId("videoPlayer");
    var audio = byId("audioPlayer");
    var input = byId("searchInput");

    video.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("timeupdate", updateProgress);
    video.addEventListener("loadedmetadata", function () { updateTimeLabels(); updatePlayButton(); });
    audio.addEventListener("loadedmetadata", function () { updateTimeLabels(); updatePlayButton(); });
    video.addEventListener("durationchange", updateTimeLabels);
    audio.addEventListener("durationchange", updateTimeLabels);
    video.addEventListener("play", updatePlayButton);
    audio.addEventListener("play", updatePlayButton);
    video.addEventListener("pause", updatePlayButton);
    audio.addEventListener("pause", updatePlayButton);
    video.addEventListener("ended", function () { updatePlayButton(); showToast("Reproduccion terminada"); renderRows(); });
    audio.addEventListener("ended", function () { updatePlayButton(); showToast("Reproduccion terminada"); renderRows(); });
    video.addEventListener("error", function () { showToast("No se pudo cargar el video"); });
    audio.addEventListener("error", function () { showToast("No se pudo cargar el audio"); });

    input.addEventListener("input", scheduleSearch);

    window.addEventListener("message", function (event) {
      var data = event.data || {};
      var frame = byId("youtubePlayer");
      if (!frame || event.source !== frame.contentWindow || data.source !== "medianest-player") {
        return;
      }
      if (data.type === "ready") {
        state.youtubeDuration = Number(data.data && data.data.duration) || 0;
        showToast("Reproduciendo dentro de MediaNest");
      } else if (data.type === "state") {
        state.youtubeState = Number(data.data && data.data.state);
        state.youtubeTime = Number(data.data && data.data.currentTime) || state.youtubeTime;
        state.youtubeDuration = Number(data.data && data.data.duration) || state.youtubeDuration;
      } else if (data.type === "time") {
        state.youtubeTime = Number(data.data && data.data.currentTime) || 0;
        state.youtubeDuration = Number(data.data && data.data.duration) || state.youtubeDuration;
      } else if (data.type === "error") {
        showToast("Este video no permite reproduccion integrada");
      }
      updatePlayButton();
      updateTimeLabels();
    });

    document.addEventListener("click", function (event) {
      var target = event.target;
      var items;
      var i;

      while (target && target !== document.body && target.className.indexOf("focusable") === -1) {
        target = target.parentNode;
      }
      if (target && target.className && target.className.indexOf("focusable") !== -1) {
        items = getFocusables();
        for (i = 0; i < items.length; i += 1) {
          if (items[i] === target) {
            setFocus(i);
            activateCurrent();
            break;
          }
        }
      }
    });

    document.addEventListener("keydown", onKeyDown);
  }

  function boot() {
    state.saved = readStore(STORAGE.SAVED);
    state.recent = readStore(STORAGE.RECENT);
    state.recommended = fallbackItems();
    bindEvents();
    renderRows();
    updateHero();
    loadRecommendations();
    setFocus(0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}());
