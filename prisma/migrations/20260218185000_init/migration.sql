-- CreateTable
CREATE TABLE "Song" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "albumArtist" TEXT,
    "trackNumber" INTEGER,
    "discNumber" INTEGER,
    "year" INTEGER,
    "genre" TEXT,
    "isrc" TEXT,
    "lyrics" TEXT,
    "rating" INTEGER,
    "starredAt" DATETIME,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" DATETIME,
    "bitrate" INTEGER,
    "sampleRate" INTEGER,
    "channels" INTEGER,
    "replayGainTrackDb" REAL,
    "replayGainAlbumDb" REAL,
    "replayGainTrackPeak" REAL,
    "replayGainAlbumPeak" REAL,
    "duration" INTEGER,
    "format" TEXT NOT NULL,
    "quality" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "filePath" TEXT NOT NULL,
    "relativePath" TEXT,
    "fileMtime" DATETIME,
    "fileHash" TEXT,
    "coverPath" TEXT,
    "thumbnail" TEXT,
    "fileSize" INTEGER,
    "artistId" INTEGER,
    "albumId" INTEGER,
    "libraryId" INTEGER,
    "playlistId" INTEGER,
    "downloadTaskId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Song_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Song_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Song_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Song_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Song_downloadTaskId_fkey" FOREIGN KEY ("downloadTaskId") REFERENCES "DownloadTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "subsonicToken" TEXT,
    "subsonicPasswordEnc" TEXT,
    "authTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Playlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SmartPlaylist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ruleJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SmartPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistSong" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "quality" TEXT,
    "bestAudioPreference" TEXT,
    "playlistId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "playlistTitle" TEXT,
    "isPlaylist" BOOLEAN NOT NULL DEFAULT false,
    "totalItems" INTEGER,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "successfulItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "workerPid" INTEGER,
    "heartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DownloadTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadTask_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadTaskEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "taskId" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DownloadTaskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DownloadTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaybackSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "currentSongId" INTEGER,
    "positionSec" REAL NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "repeatMode" TEXT NOT NULL DEFAULT 'off',
    "shuffle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaybackSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaybackSession_currentSongId_fkey" FOREIGN KEY ("currentSongId") REFERENCES "Song" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaybackQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaybackQueueItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlaybackSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaybackQueueItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortName" TEXT,
    "mbid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Album" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "artistId" INTEGER,
    "albumArtist" TEXT,
    "year" INTEGER,
    "coverPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Album_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "positionSec" REAL NOT NULL DEFAULT 0,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" DATETIME NOT NULL,
    CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookmark_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Share" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "description" TEXT,
    "expiresAt" DATETIME,
    "lastVisited" DATETIME,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "shareId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "songId" INTEGER,
    "albumId" INTEGER,
    "playlistId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareEntry_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareEntry_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareEntry_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareEntry_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Library" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Library_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LibraryPath" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryPath_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LibraryScanRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "statsJson" TEXT,
    "error" TEXT,
    CONSTRAINT "LibraryScanRun_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SongTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SongTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SongTagAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "songId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongTagAssignment_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SongTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "SongTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "Song_playlistId_idx" ON "Song"("playlistId");

-- CreateIndex
CREATE INDEX "Song_source_idx" ON "Song"("source");

-- CreateIndex
CREATE INDEX "Song_createdAt_idx" ON "Song"("createdAt");

-- CreateIndex
CREATE INDEX "Song_title_idx" ON "Song"("title");

-- CreateIndex
CREATE INDEX "Song_artist_idx" ON "Song"("artist");

-- CreateIndex
CREATE INDEX "Song_userId_createdAt_idx" ON "Song"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Song_userId_playlistId_idx" ON "Song"("userId", "playlistId");

-- CreateIndex
CREATE INDEX "Song_userId_albumId_discNumber_trackNumber_idx" ON "Song"("userId", "albumId", "discNumber", "trackNumber");

-- CreateIndex
CREATE INDEX "Song_artistId_idx" ON "Song"("artistId");

-- CreateIndex
CREATE INDEX "Song_albumId_idx" ON "Song"("albumId");

-- CreateIndex
CREATE INDEX "Song_libraryId_idx" ON "Song"("libraryId");

-- CreateIndex
CREATE INDEX "Song_userId_rating_idx" ON "Song"("userId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "Song_userId_source_sourceUrl_key" ON "Song"("userId", "source", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_userId_name_key" ON "Playlist"("userId", "name");

-- CreateIndex
CREATE INDEX "SmartPlaylist_userId_updatedAt_idx" ON "SmartPlaylist"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmartPlaylist_userId_name_key" ON "SmartPlaylist"("userId", "name");

-- CreateIndex
CREATE INDEX "PlaylistSong_playlistId_songId_idx" ON "PlaylistSong"("playlistId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistSong_playlistId_position_key" ON "PlaylistSong"("playlistId", "position");

-- CreateIndex
CREATE INDEX "DownloadTask_status_idx" ON "DownloadTask"("status");

-- CreateIndex
CREATE INDEX "DownloadTask_createdAt_idx" ON "DownloadTask"("createdAt");

-- CreateIndex
CREATE INDEX "DownloadTask_userId_status_createdAt_idx" ON "DownloadTask"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DownloadTaskEvent_taskId_idx" ON "DownloadTaskEvent"("taskId");

-- CreateIndex
CREATE INDEX "DownloadTaskEvent_userId_taskId_createdAt_idx" ON "DownloadTaskEvent"("userId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PlaybackSession_userId_updatedAt_idx" ON "PlaybackSession"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackSession_userId_deviceId_key" ON "PlaybackSession"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "PlaybackQueueItem_sessionId_songId_idx" ON "PlaybackQueueItem"("sessionId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackQueueItem_sessionId_sortOrder_key" ON "PlaybackQueueItem"("sessionId", "sortOrder");

-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_userId_name_key" ON "Artist"("userId", "name");

-- CreateIndex
CREATE INDEX "Album_artistId_title_idx" ON "Album"("artistId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Album_userId_title_albumArtist_key" ON "Album"("userId", "title", "albumArtist");

-- CreateIndex
CREATE INDEX "Bookmark_userId_changedAt_idx" ON "Bookmark"("userId", "changedAt");

-- CreateIndex
CREATE INDEX "Bookmark_songId_idx" ON "Bookmark"("songId");

-- CreateIndex
CREATE UNIQUE INDEX "Share_token_key" ON "Share"("token");

-- CreateIndex
CREATE INDEX "Share_userId_createdAt_idx" ON "Share"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareEntry_userId_shareId_idx" ON "ShareEntry"("userId", "shareId");

-- CreateIndex
CREATE INDEX "ShareEntry_songId_idx" ON "ShareEntry"("songId");

-- CreateIndex
CREATE INDEX "ShareEntry_albumId_idx" ON "ShareEntry"("albumId");

-- CreateIndex
CREATE INDEX "ShareEntry_playlistId_idx" ON "ShareEntry"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "Library_userId_name_key" ON "Library"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPath_libraryId_path_key" ON "LibraryPath"("libraryId", "path");

-- CreateIndex
CREATE INDEX "LibraryScanRun_libraryId_startedAt_idx" ON "LibraryScanRun"("libraryId", "startedAt");

-- CreateIndex
CREATE INDEX "SongTag_userId_updatedAt_idx" ON "SongTag"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SongTag_userId_name_key" ON "SongTag"("userId", "name");

-- CreateIndex
CREATE INDEX "SongTagAssignment_tagId_createdAt_idx" ON "SongTagAssignment"("tagId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SongTagAssignment_songId_tagId_key" ON "SongTagAssignment"("songId", "tagId");

-- CreateIndex
CREATE INDEX "RateLimitEvent_key_createdAt_idx" ON "RateLimitEvent"("key", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitEvent_createdAt_idx" ON "RateLimitEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_key_bucketStart_idx" ON "RateLimitBucket"("key", "bucketStart");

-- CreateIndex
CREATE INDEX "RateLimitBucket_bucketStart_idx" ON "RateLimitBucket"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_bucketStart_key" ON "RateLimitBucket"("key", "bucketStart");

