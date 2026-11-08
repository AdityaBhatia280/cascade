/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// Edited by hand: no router plugin is installed. Add a route here when you add a file in src/routes/.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as SiteRouteImport } from './routes/site'
import { Route as WeekRouteImport } from './routes/week'
import { Route as HandoffRouteImport } from './routes/handoff'
import { Route as ProceduresRouteImport } from './routes/procedures'
import { Route as ApprovalsRouteImport } from './routes/approvals'
import { Route as IngestRouteImport } from './routes/ingest'

const IndexRoute = IndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => rootRouteImport } as any)
const SiteRoute = SiteRouteImport.update({ id: '/site', path: '/site', getParentRoute: () => rootRouteImport } as any)
const WeekRoute = WeekRouteImport.update({ id: '/week', path: '/week', getParentRoute: () => rootRouteImport } as any)
const HandoffRoute = HandoffRouteImport.update({ id: '/handoff', path: '/handoff', getParentRoute: () => rootRouteImport } as any)
const ProceduresRoute = ProceduresRouteImport.update({ id: '/procedures', path: '/procedures', getParentRoute: () => rootRouteImport } as any)
const ApprovalsRoute = ApprovalsRouteImport.update({ id: '/approvals', path: '/approvals', getParentRoute: () => rootRouteImport } as any)
const IngestRoute = IngestRouteImport.update({ id: '/ingest', path: '/ingest', getParentRoute: () => rootRouteImport } as any)

type Paths = '/' | '/site' | '/week' | '/handoff' | '/procedures' | '/approvals' | '/ingest'

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/site': typeof SiteRoute
  '/week': typeof WeekRoute
  '/handoff': typeof HandoffRoute
  '/procedures': typeof ProceduresRoute
  '/approvals': typeof ApprovalsRoute
  '/ingest': typeof IngestRoute
}
export interface FileRoutesByTo extends FileRoutesByFullPath {}
export interface FileRoutesById extends FileRoutesByFullPath {
  __root__: typeof rootRouteImport
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: Paths
  fileRoutesByTo: FileRoutesByTo
  to: Paths
  id: '__root__' | Paths
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  SiteRoute: typeof SiteRoute
  WeekRoute: typeof WeekRoute
  HandoffRoute: typeof HandoffRoute
  ProceduresRoute: typeof ProceduresRoute
  ApprovalsRoute: typeof ApprovalsRoute
  IngestRoute: typeof IngestRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': { id: '/'; path: '/'; fullPath: '/'; preLoaderRoute: typeof IndexRouteImport; parentRoute: typeof rootRouteImport }
    '/site': { id: '/site'; path: '/site'; fullPath: '/site'; preLoaderRoute: typeof SiteRouteImport; parentRoute: typeof rootRouteImport }
    '/week': { id: '/week'; path: '/week'; fullPath: '/week'; preLoaderRoute: typeof WeekRouteImport; parentRoute: typeof rootRouteImport }
    '/handoff': { id: '/handoff'; path: '/handoff'; fullPath: '/handoff'; preLoaderRoute: typeof HandoffRouteImport; parentRoute: typeof rootRouteImport }
    '/procedures': { id: '/procedures'; path: '/procedures'; fullPath: '/procedures'; preLoaderRoute: typeof ProceduresRouteImport; parentRoute: typeof rootRouteImport }
    '/approvals': { id: '/approvals'; path: '/approvals'; fullPath: '/approvals'; preLoaderRoute: typeof ApprovalsRouteImport; parentRoute: typeof rootRouteImport }
    '/ingest': { id: '/ingest'; path: '/ingest'; fullPath: '/ingest'; preLoaderRoute: typeof IngestRouteImport; parentRoute: typeof rootRouteImport }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  SiteRoute: SiteRoute,
  WeekRoute: WeekRoute,
  HandoffRoute: HandoffRoute,
  ProceduresRoute: ProceduresRoute,
  ApprovalsRoute: ApprovalsRoute,
  IngestRoute: IngestRoute,
}
export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren)._addFileTypes<FileRouteTypes>()
