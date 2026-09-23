import { getVaultFileKind } from '../../../domain/file-kind.js';

export class RoomRegistry {
  constructor({ createRoom }) {
    this.createRoom = createRoom;
    this.rooms = new Map();
  }

  get(name) {
    return this.rooms.get(name);
  }

  getOrCreate(name) {
    const existingRoom = this.rooms.get(name);
    if (!existingRoom || existingRoom.isDeleted?.()) {
      const room = this.createRoom({
        name,
        onEmpty: (roomName) => {
          if (this.rooms.get(roomName) === room) {
            this.rooms.delete(roomName);
          }
        },
      });

      this.rooms.set(name, room);
    }

    return this.rooms.get(name);
  }

  rename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) {
      return false;
    }

    const oldKind = getVaultFileKind(oldName);
    const newKind = getVaultFileKind(newName);
    if (oldKind !== newKind && [oldKind, newKind].includes('canvas')) return false;

    const room = this.rooms.get(oldName);
    if (!room) {
      return false;
    }

    if (this.rooms.has(newName)) {
      return false;
    }

    this.rooms.delete(oldName);
    room.rename?.(newName);
    this.rooms.set(newName, room);
    return true;
  }

  delete(name) {
    return this.rooms.delete(name);
  }

  async reset() {
    await Promise.allSettled(
      Array.from(this.rooms.values(), (room) => room.destroy?.()),
    );
    this.rooms.clear();
  }

  getRooms() {
    return Array.from(this.rooms.entries());
  }

  async reconcileWorkspaceChange(workspaceChange = {}) {
    const deletedPaths = new Set(workspaceChange.deletedPaths ?? []);
    const renamedPaths = Array.isArray(workspaceChange.renamedPaths) ? workspaceChange.renamedPaths : [];
    const pendingDeletes = [];
    const highlightRanges = [];
    const reloadRequiredPaths = [];

    renamedPaths.forEach((entry) => {
      if (!entry?.oldPath || !entry?.newPath) {
        return;
      }

      if (this.rename(entry.oldPath, entry.newPath)) {
        return;
      }

      const room = this.rooms.get(entry.oldPath);
      if (room) {
        pendingDeletes.push([entry.oldPath, room]);
      }
    });

    deletedPaths.forEach((pathValue) => {
      if (!pathValue) {
        return;
      }

      const room = this.rooms.get(pathValue);
      if (room) {
        pendingDeletes.push([pathValue, room]);
      }
    });

    await Promise.allSettled(
      pendingDeletes.map(async ([pathValue, room]) => {
        room.markDeleted?.();
        if (typeof room.applyExternalDeletion === 'function') {
          await room.applyExternalDeletion();
        } else {
          await room.destroy?.();
        }
        if (this.rooms.get(pathValue) === room) {
          this.rooms.delete(pathValue);
        }
      }),
    );

    const blockedPaths = new Set([
      ...deletedPaths,
      ...renamedPaths.flatMap((entry) => [entry?.oldPath, entry?.newPath]),
    ]);
    await Promise.allSettled(
      Array.from(new Set(workspaceChange.changedPaths ?? []))
        .filter((pathValue) => pathValue && !blockedPaths.has(pathValue))
        .map(async (pathValue) => {
          const room = this.rooms.get(pathValue);
          if (!room || room.isDeleted?.()) {
            return;
          }

          const result = await room.reloadFromDisk?.();
          if (result && result.ok === false && ['invalid-excalidraw', 'invalid-canvas'].includes(result.reason)) {
            reloadRequiredPaths.push(pathValue);
          } else if (result?.highlightRange) {
            highlightRanges.push({
              from: result.highlightRange.from,
              path: pathValue,
              to: result.highlightRange.to,
            });
          }
        }),
    );

    return {
      highlightRanges,
      reloadRequiredPaths,
    };
  }
}
