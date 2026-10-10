# Dokudocs

A technical documentation system: people write Markdown together in real time, like Google Docs, and review each other's changes without losing work.

## Language

**Suggestion**:
A proposed change to a document that waits for an editor to accept or reject it. It does not change the document until it is accepted.
_Avoid_: Comment, edit request, AI edit

**Mode**:
How a person works with an open document: View, Edit, or Suggest.
_Avoid_: Tab (that is the control, not the concept), state

**Pending edit**:
A change a person has typed that the server has not accepted yet. It stays on the device and is sent again until the server accepts it.
_Avoid_: Unsaved change, draft, local change

**Held edit**:
A pending edit that cannot be sent again automatically. It is kept so nothing is lost until a person decides what to do with it. People should never meet it in ordinary editing.
_Avoid_: Conflict, review, rejected edit

**Mermaid document**:
A document whose body is Mermaid text: flowcharts, sequence diagrams and the like.
_Avoid_: Flow, flow document

## Architecture

**Architecture document**:
A document that draws a software system as a canvas of Hosts, Systems and the Connections between them. It is a document like any other: it lives in a project, follows the same access rules, and a project may hold several (Prod, Staging, a target design).
_Avoid_: Diagram, architecture map, canvas (that is the surface, not the document)

**Host**:
A place where software runs: a VPS, a VM, a cluster, a laptop, a managed cloud service. A Host may sit inside another Host.
_Avoid_: Device, server, machine

**System**:
A piece of software drawn on the canvas, such as a Go backend, a React frontend, Nginx, PostgreSQL or Kafka. It runs on a Host, or stands alone when it is external (a SaaS such as Stripe). A System never contains another System.
_Avoid_: Service, component, app

**Connection**:
A directed line from one System to another, saying the first one talks to the second over a protocol (REST, gRPC, a database connection, publish or subscribe to a broker). A broker is a System, so a message that goes through Kafka is two Connections. Two Systems may have several Connections.
_Avoid_: Edge (the canvas word), link, relation, penghubung

**Group**:
A labelled box that gathers nodes on the canvas for readability. It means nothing about where or how software runs.
_Avoid_: Container, zone

**Catalog entry**:
A built-in kind a node or Connection can be: a language, framework, database, broker, host type or protocol, with its name and icon. The catalog is the same for everyone and people cannot add to it.
_Avoid_: Master data, template, preset

**Document link**:
A reference from a System or a Connection to an existing document (Markdown, DBML or Mermaid). The document stays where it is and keeps its own access; removing the link, the System or Connection that holds it, or the Architecture document never removes the document. One document may be linked from many Systems.
_Avoid_: Embed, attachment, child document

**Architecture version**:
A labelled, frozen state of an Architecture document together with the state of every document it links to at that moment ("Prod v2.0"). Its content never changes; its label and description may.
_Avoid_: Tag (the control, not the concept), release, snapshot

## Accounts

**Linked identity**:
An account at an outside provider (Google now, GitHub later) tied to one User. It is matched by the provider's own id for the person, never by email alone.
_Avoid_: OAuth account, social login, SSO

**Sign-in method**:
A way a User can sign in: a password, or a Linked identity. A User always keeps at least one.
_Avoid_: Auth type, login option

**Verified email**:
An address the User has proven to be theirs, by opening the link we mailed or because the provider they signed in with reported it as verified. Until it is verified, the app is closed to the User except for verifying.
_Avoid_: Confirmed email, activated account

**Takeover**:
Signing in with a provider whose verified email matches a local account that never verified its email. The account is kept, its password is dropped, and the Linked identity is added (ADR-0034).
