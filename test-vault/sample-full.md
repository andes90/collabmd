# CollabMD — Technical Design Document

> A collaborative markdown vault with real-time editing, wiki-links, and embedded diagrams.

## Overview

CollabMD turns any folder of markdown files into a collaborative wiki. Multiple users can edit the same file simultaneously through a browser-based editor powered by [[Yjs]] and [[CodeMirror]].

Key features:

- Real-time collaborative editing via WebSocket + Yjs CRDT
- Wiki-link resolution with bi-directional backlinks
- Mermaid diagram rendering
- Excalidraw drawing embeds
- Cloudflare tunnel for instant public sharing

---

## System Architecture

### High-Level Overview

```mermaid
graph LR
    A[Browser] -->|WebSocket| B[Node.js Server]
    A -->|HTTP REST| B
    B -->|Read/Write| C[Filesystem]
    B -->|Yjs Sync| D[Collaboration Room]
    D -->|Awareness| E[Lobby Room]
```

### Detailed Component Diagram

![[system-architecture.excalidraw]]

The diagram above is fully editable — try drawing on it directly in the preview panel.

---

## Data Flow

### File Edit Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant X
    participant Editor as CodeMirror
    participant Yjs as Yjs Document
    participant WS as WebSocket
    participant Server
    participant FS as Filesystem

    User->>Editor: Type content
    Editor->>Yjs: Apply delta
    Yjs->>WS: Broadcast update
    WS->>Server: Sync to room
    Server->>FS: Persist (debounced)
    Server-->>WS: Ack + relay
    WS-->>Yjs: Merge remote
    Yjs-->>Editor: Update view
```

### Backlink Index Updates

```mermaid
flowchart TD
    A[File Created/Saved] --> B{Contains wiki-links?}
    B -->|Yes| C[Extract link targets]
    B -->|No| D[Remove old forward links]
    C --> E[Update forward map]
    E --> F[Rebuild reverse map]
    D --> F
    F --> G[Index ready for queries]
    G --> H[GET /api/backlinks?file=X]
```

---

## Module Structure

### Server Architecture

```mermaid
graph TD
    subgraph Server
        A[bin/collabmd.js] --> B[create-app-server.js]
        B --> C[HTTP Request Handler]
        B --> D[WebSocket Gateway]
        B --> E[VaultFileStore]
        B --> F[BacklinkIndex]
        D --> G[RoomRegistry]
        G --> H[CollaborationRoom]
        H --> I[Yjs Document]
        H --> E
    end

    subgraph Client
        J[main.js] --> K[CollabMdApp]
        K --> L[EditorSession]
        K --> M[PreviewRenderer]
        K --> N[FileExplorer]
        K --> O[LobbyPresence]
        K --> P[ExcalidrawEmbed]
    end

    C <-->|REST API| K
    D <-->|WebSocket| L
    D <-->|Awareness| O
```

### File Type Support

| Type | Extension | Editor | Preview |
|------|-----------|--------|---------|
| Markdown | `.md` | CodeMirror | Rendered HTML |
| Excalidraw | `.excalidraw` | Excalidraw (iframe) | Inline embed |
| Mermaid | fenced block | CodeMirror | SVG diagram |

---

## Collaboration Protocol

### User Presence States

```mermaid
stateDiagram-v2
    [*] --> Connecting
    Connecting --> Connected: WebSocket open
    Connecting --> Unreachable: Timeout
    Connected --> Disconnected: WebSocket close
    Disconnected --> Connecting: Auto-reconnect
    Unreachable --> Connecting: Retry

    state Connected {
        [*] --> Idle
        Idle --> Editing: Keystroke
        Editing --> Idle: 3s inactivity
        Idle --> Following: Click follow
        Following --> Idle: Unfollow
    }
```

### Awareness Data Structure

Each connected user broadcasts:

```json
{
  "user": {
    "name": "Alice",
    "color": "#818cf8",
    "peerId": "tab-abc123",
    "currentFile": "projects/collabmd.md"
  },
  "cursor": {
    "anchor": 142,
    "head": 142
  }
}
```

---

## API Endpoints

```mermaid
graph LR
    subgraph "REST API"
        A["GET /api/files"] --> B["File tree"]
        C["GET /api/file?path=..."] --> D["File content"]
        E["POST /api/file"] --> F["Create file"]
        G["PUT /api/file"] --> H["Update file"]
        I["DELETE /api/file"] --> J["Delete file"]
        K["PATCH /api/file"] --> L["Rename file"]
        M["GET /api/backlinks"] --> N["Backlink list"]
    end
```

---

## Deployment Architecture

```mermaid
graph TB
    subgraph "User's Machine"
        A[collabmd CLI] --> B[Node.js HTTP Server]
        B --> C[Static Files]
        B --> D[WebSocket Server]
        B --> E[Local Filesystem]
    end

    A --> F[Cloudflare Tunnel]
    F --> G[*.trycloudflare.com]

    H[Remote User 1] --> G
    I[Remote User 2] --> G
    J[Local User] --> B
```

---

## Wiki-Link Resolution

Links are resolved in order:

1. **Exact path match** — `[[projects/collabmd.md]]`
2. **Filename match** — `[[collabmd]]` resolves to `projects/collabmd.md`
3. **Create new** — unresolved links show dashed underline, click to create

### Link Graph Example

```mermaid
graph LR
    A[README] --> B[CollabMD Project]
    A --> C[Daily Notes]
    B --> D[Technical Design]
    D --> B
    C --> B
    D --> E[API Reference]
    E --> D
```

The bi-directional arrows show how the backlink index tracks both forward and reverse relationships.

---

## Performance Characteristics

```mermaid
pie title Time Spent in Render Pipeline
    "Markdown Parse" : 35
    "Mermaid Render" : 25
    "Wiki-Link Resolution" : 10
    "Excalidraw iFrame Load" : 20
    "Scroll Sync" : 10
```

---

*This document itself is a demo of CollabMD's rendering capabilities — Mermaid diagrams, wiki-links, Excalidraw embeds, and standard markdown all working together.*
# CollabMD — Technical Design Document

> A collaborative markdown vault with real-time editing, wiki-links, and embedded diagrams.

## Overview

CollabMD turns any folder of markdown files into a collaborative wiki. Multiple users can edit the same file simultaneously through a browser-based editor powered by [[Yjs]] and [[CodeMirror]].

Key features:

- Real-time collaborative editing via WebSocket + Yjs CRDT
- Wiki-link resolution with bi-directional backlinks
- Mermaid diagram rendering
- Excalidraw drawing embeds
- Cloudflare tunnel for instant public sharing

---

## System Architecture

### High-Level Overview

```mermaid
graph LR
    A[Browser] -->|WebSocket| B[Node.js Server]
    A -->|HTTP REST| B
    B -->|Read/Write| C[Filesystem]
    B -->|Yjs Sync| D[Collaboration Room]
    D -->|Awareness| E[Lobby Room]
```

### Detailed Component Diagram

![[system-architecture.excalidraw]]

The diagram above is fully editable — try drawing on it directly in the preview panel.

---

## Data Flow

### File Edit Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Editor as CodeMirror
    participant Yjs as Yjs Document
    participant WS as WebSocket
    participant Server
    participant FS as Filesystem

    User->>Editor: Type content
    Editor->>Yjs: Apply delta
    Yjs->>WS: Broadcast update
    WS->>Server: Sync to room
    Server->>FS: Persist (debounced)
    Server-->>WS: Ack + relay
    WS-->>Yjs: Merge remote
    Yjs-->>Editor: Update view
```

### Backlink Index Updates

```mermaid
flowchart TD
    A[File Created/Saved] --> B{Contains wiki-links?}
    B -->|Yes| C[Extract link targets]
    B -->|No| D[Remove old forward links]
    C --> E[Update forward map]
    E --> F[Rebuild reverse map]
    D --> F
    F --> G[Index ready for queries]
    G --> H[GET /api/backlinks?file=X]
```

---

## Module Structure

### Server Architecture

```mermaid
graph TD
    subgraph Server
        A[bin/collabmd.js] --> B[create-app-server.js]
        B --> C[HTTP Request Handler]
        B --> D[WebSocket Gateway]
        B --> E[VaultFileStore]
        B --> F[BacklinkIndex]
        D --> G[RoomRegistry]
        G --> H[CollaborationRoom]
        H --> I[Yjs Document]
        H --> E
    end

    subgraph Client
        J[main.js] --> K[CollabMdApp]
        K --> L[EditorSession]
        K --> M[PreviewRenderer]
        K --> N[FileExplorer]
        K --> O[LobbyPresence]
        K --> P[ExcalidrawEmbed]
    end

    C <-->|REST API| K
    D <-->|WebSocket| L
    D <-->|Awareness| O
```

### File Type Support

| Type | Extension | Editor | Preview |
|------|-----------|--------|---------|
| Markdown | `.md` | CodeMirror | Rendered HTML |
| Excalidraw | `.excalidraw` | Excalidraw (iframe) | Inline embed |
| Mermaid | fenced block | CodeMirror | SVG diagram |

---

## Collaboration Protocol

### User Presence States

```mermaid
stateDiagram-v2
    [*] --> Connecting
    Connecting --> Connected: WebSocket open
    Connecting --> Unreachable: Timeout
    Connected --> Disconnected: WebSocket close
    Disconnected --> Connecting: Auto-reconnect
    Unreachable --> Connecting: Retry

    state Connected {
        [*] --> Idle
        Idle --> Editing: Keystroke
        Editing --> Idle: 3s inactivity
        Idle --> Following: Click follow
        Following --> Idle: Unfollow
    }
```

### Awareness Data Structure

Each connected user broadcasts:

```json
{
  "user": {
    "name": "Alice",
    "color": "#818cf8",
    "peerId": "tab-abc123",
    "currentFile": "projects/collabmd.md"
  },
  "cursor": {
    "anchor": 142,
    "head": 142
  }
}
```

---

## API Endpoints

```mermaid
graph LR
    subgraph "REST API"
        A["GET /api/files"] --> B["File tree"]
        C["GET /api/file?path=..."] --> D["File content"]
        E["POST /api/file"] --> F["Create file"]
        G["PUT /api/file"] --> H["Update file"]
        I["DELETE /api/file"] --> J["Delete file"]
        K["PATCH /api/file"] --> L["Rename file"]
        M["GET /api/backlinks"] --> N["Backlink list"]
    end
```

---

## Deployment Architecture

```mermaid
graph TB
    subgraph "User's Machine"
        A[collabmd CLI] --> B[Node.js HTTP Server]
        B --> C[Static Files]
        B --> D[WebSocket Server]
        B --> E[Local Filesystem]
    end

    A --> F[Cloudflare Tunnel]
    F --> G[*.trycloudflare.com]

    H[Remote User 1] --> G
    I[Remote User 2] --> G
    J[Local User] --> B
```

---

## Wiki-Link Resolution

Links are resolved in order:

1. **Exact path match** — `[[projects/collabmd.md]]`
2. **Filename match** — `[[collabmd]]` resolves to `projects/collabmd.md`
3. **Create new** — unresolved links show dashed underline, click to create

### Link Graph Example

```mermaid
graph LR
    A[README] --> B[CollabMD Project]
    A --> C[Daily Notes]
    B --> D[Technical Design]
    D --> B
    C --> B
    D --> E[API Reference]
    E --> D
```

The bi-directional arrows show how the backlink index tracks both forward and reverse relationships.

---

## Performance Characteristics

```mermaid
pie title Time Spent in Render Pipeline
    "Markdown Parse" : 35
    "Mermaid Render" : 25
    "Wiki-Link Resolution" : 10
    "Excalidraw iFrame Load" : 20
    "Scroll Sync" : 10
```

---

*This document itself is a demo of CollabMD's rendering capabilities — Mermaid diagrams, wiki-links, Excalidraw embeds, and standard markdown all working together.*
