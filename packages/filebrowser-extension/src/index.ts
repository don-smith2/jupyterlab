// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ApplicationShell,
  ILayoutRestorer,
  JupyterLab,
  JupyterLabPlugin
} from '@jupyterlab/application';

import {
  Clipboard,
  InstanceTracker,
  MainAreaWidget,
  ToolbarButton
} from '@jupyterlab/apputils';

import { IStateDB, PageConfig, PathExt, URLExt } from '@jupyterlab/coreutils';

import { IDocumentManager } from '@jupyterlab/docmanager';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import {
  FileBrowserModel,
  FileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';

import { Launcher } from '@jupyterlab/launcher';

import { Contents } from '@jupyterlab/services';

import { map, toArray } from '@phosphor/algorithm';

import { CommandRegistry } from '@phosphor/commands';

import { Menu } from '@phosphor/widgets';

/**
 * The command IDs used by the file browser plugin.
 */
namespace CommandIDs {
  export const copy = 'filebrowser:copy';

  export const copyDownloadLink = 'filebrowser:copy-download-link';

  // For main browser only.
  export const createLauncher = 'filebrowser:create-main-launcher';

  export const cut = 'filebrowser:cut';

  export const del = 'filebrowser:delete';

  export const download = 'filebrowser:download';

  export const duplicate = 'filebrowser:duplicate';

  // For main browser only.
  export const hideBrowser = 'filebrowser:hide-main';

  export const navigate = 'filebrowser:navigate';

  export const open = 'filebrowser:open';

  export const openBrowserTab = 'filebrowser:open-browser-tab';

  export const paste = 'filebrowser:paste';

  export const rename = 'filebrowser:rename';

  // For main browser only.
  export const share = 'filebrowser:share-main';

  // For main browser only.
  export const copyPath = 'filebrowser:copy-path';

  export const showBrowser = 'filebrowser:activate';

  export const shutdown = 'filebrowser:shutdown';

  // For main browser only.
  export const toggleBrowser = 'filebrowser:toggle-main';
}

/**
 * The default file browser extension.
 */
const browser: JupyterLabPlugin<void> = {
  activate: activateBrowser,
  id: '@jupyterlab/filebrowser-extension:browser',
  requires: [IFileBrowserFactory, ILayoutRestorer],
  autoStart: true
};

/**
 * The default file browser factory provider.
 */
const factory: JupyterLabPlugin<IFileBrowserFactory> = {
  activate: activateFactory,
  id: '@jupyterlab/filebrowser-extension:factory',
  provides: IFileBrowserFactory,
  requires: [IDocumentManager, IStateDB]
};

/**
 * The file browser namespace token.
 */
const namespace = 'filebrowser';

/**
 * Export the plugins as default.
 */
const plugins: JupyterLabPlugin<any>[] = [factory, browser];
export default plugins;

/**
 * Activate the file browser factory provider.
 */
function activateFactory(
  app: JupyterLab,
  docManager: IDocumentManager,
  state: IStateDB
): IFileBrowserFactory {
  const { commands } = app;
  const tracker = new InstanceTracker<FileBrowser>({ namespace });
  const createFileBrowser = (
    id: string,
    options: IFileBrowserFactory.IOptions = {}
  ) => {
    const model = new FileBrowserModel({
      manager: docManager,
      driveName: options.driveName || '',
      refreshInterval: options.refreshInterval,
      state: options.state === null ? null : options.state || state
    });
    const widget = new FileBrowser({
      id,
      model,
      commands: options.commands || commands
    });
    const { registry } = docManager;

    // Add a launcher toolbar item.
    let launcher = new ToolbarButton({
      iconClassName: 'jp-AddIcon jp-Icon jp-Icon-16',
      onClick: () => {
        return createLauncher(commands, widget);
      },
      tooltip: 'New Launcher'
    });
    widget.toolbar.insertItem(0, 'launch', launcher);

    // Add a context menu handler to the file browser's directory listing.
    let node = widget.node.getElementsByClassName('jp-DirListing-content')[0];
    node.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      const model = widget.modelForClick(event);
      const menu = createContextMenu(model, commands, registry);
      menu.open(event.clientX, event.clientY);
    });

    // Track the newly created file browser.
    tracker.add(widget);

    return widget;
  };
  const defaultBrowser = createFileBrowser('filebrowser');

  return { createFileBrowser, defaultBrowser, tracker };
}

/**
 * Activate the default file browser in the sidebar.
 */
function activateBrowser(
  app: JupyterLab,
  factory: IFileBrowserFactory,
  restorer: ILayoutRestorer
): void {
  const browser = factory.defaultBrowser;
  const { commands, shell } = app;

  // Let the application restorer track the primary file browser (that is
  // automatically created) for restoration of application state (e.g. setting
  // the file browser as the current side bar widget).
  //
  // All other file browsers created by using the factory function are
  // responsible for their own restoration behavior, if any.
  restorer.add(browser, namespace);

  addCommands(app, factory.tracker, browser);

  browser.title.iconClass = 'jp-FolderIcon jp-SideBar-tabIcon';
  browser.title.caption = 'File Browser';
  shell.addToLeftArea(browser, { rank: 100 });

  // If the layout is a fresh session without saved data, open file browser.
  app.restored.then(layout => {
    if (layout.fresh) {
      commands.execute(CommandIDs.showBrowser, void 0);
    }
  });

  Promise.all([app.restored, browser.model.restored]).then(() => {
    function maybeCreate() {
      // Create a launcher if there are no open items.
      if (app.shell.isEmpty('main')) {
        createLauncher(commands, browser);
      }
    }

    // When layout is modified, create a launcher if there are no open items.
    shell.layoutModified.connect(() => {
      maybeCreate();
    });
    maybeCreate();
  });
}

/**
 * Add the main file browser commands to the application's command registry.
 */
function addCommands(
  app: JupyterLab,
  tracker: InstanceTracker<FileBrowser>,
  browser: FileBrowser
): void {
  const getBrowserForPath = (path: string): FileBrowser => {
    const driveName = app.serviceManager.contents.driveName(path);

    if (driveName) {
      let browserForPath = tracker.find(fb => fb.model.driveName === driveName);

      if (!browserForPath) {
        // warn that no filebrowser could be found for this driveName
        console.warn(
          `${CommandIDs.navigate} failed to find filebrowser for path: ${path}`
        );
        return;
      }

      return browserForPath;
    }

    // if driveName is empty, assume the main filebrowser
    return browser;
  };
  const { commands } = app;

  commands.addCommand(CommandIDs.del, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.delete();
      }
    },
    iconClass: 'jp-MaterialIcon jp-CloseIcon',
    label: 'Delete',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.copy, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.copy();
      }
    },
    iconClass: 'jp-MaterialIcon jp-CopyIcon',
    label: 'Copy',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.cut, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.cut();
      }
    },
    iconClass: 'jp-MaterialIcon jp-CutIcon',
    label: 'Cut'
  });

  commands.addCommand(CommandIDs.download, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.download();
      }
    },
    iconClass: 'jp-MaterialIcon jp-DownloadIcon',
    label: 'Download'
  });

  commands.addCommand(CommandIDs.duplicate, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.duplicate();
      }
    },
    iconClass: 'jp-MaterialIcon jp-CopyIcon',
    label: 'Duplicate'
  });

  commands.addCommand(CommandIDs.hideBrowser, {
    execute: () => {
      if (!browser.isHidden) {
        app.shell.collapseLeft();
      }
    }
  });

  commands.addCommand(CommandIDs.navigate, {
    execute: args => {
      const path = (args.path as string) || '';
      const browserForPath = getBrowserForPath(path);
      const services = app.serviceManager;
      const localPath = services.contents.localPath(path);
      const failure = (reason: any) => {
        console.warn(`${CommandIDs.navigate} failed to open: ${path}`, reason);
      };

      return services.ready
        .then(() => services.contents.get(path))
        .then(value => {
          const { model } = browserForPath;
          const { restored } = model;

          if (value.type === 'directory') {
            return restored.then(() => model.cd(`/${localPath}`));
          }

          return restored
            .then(() => model.cd(`/${PathExt.dirname(localPath)}`))
            .then(() => commands.execute('docmanager:open', { path: path }));
        })
        .catch(failure);
    }
  });

  commands.addCommand(CommandIDs.open, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (!widget) {
        return;
      }

      return Promise.all(
        toArray(
          map(widget.selectedItems(), item => {
            if (item.type === 'directory') {
              return widget.model.cd(item.name);
            }

            return commands.execute('docmanager:open', { path: item.path });
          })
        )
      );
    },
    iconClass: 'jp-MaterialIcon jp-OpenFolderIcon',
    label: 'Open',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.openBrowserTab, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (!widget) {
        return;
      }

      return Promise.all(
        toArray(
          map(widget.selectedItems(), item => {
            return commands.execute('docmanager:open-browser-tab', {
              path: item.path
            });
          })
        )
      );
    },
    iconClass: 'jp-MaterialIcon jp-AddIcon',
    label: 'Open in New Browser Tab',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.copyDownloadLink, {
    execute: () => {
      const widget = tracker.currentWidget;
      if (!widget) {
        return;
      }

      return browser.model.manager.services.contents
        .getDownloadUrl(browser.selectedItems().next().path)
        .then(url => {
          Clipboard.copyToSystem(url);
        });
    },
    iconClass: 'jp-MaterialIcon jp-CopyIcon',
    label: 'Copy Download Link',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.paste, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.paste();
      }
    },
    iconClass: 'jp-MaterialIcon jp-PasteIcon',
    label: 'Paste',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.rename, {
    execute: args => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.rename();
      }
    },
    iconClass: 'jp-MaterialIcon jp-EditIcon',
    label: 'Rename',
    mnemonic: 0
  });

  commands.addCommand(CommandIDs.share, {
    execute: () => {
      const path = encodeURIComponent(browser.selectedItems().next().path);
      const tree = PageConfig.getTreeUrl({ workspace: true });

      Clipboard.copyToSystem(URLExt.join(tree, path));
    },
    isVisible: () => toArray(browser.selectedItems()).length === 1,
    iconClass: 'jp-MaterialIcon jp-LinkIcon',
    label: 'Copy Shareable Link'
  });

  commands.addCommand(CommandIDs.copyPath, {
    execute: () => {
      const item = browser.selectedItems().next();
      if (!item) {
        return;
      }

      Clipboard.copyToSystem(item.path);
    },
    isVisible: () => browser.selectedItems().next !== undefined,
    iconClass: 'jp-MaterialIcon jp-FileIcon',
    label: 'Copy Path'
  });

  commands.addCommand(CommandIDs.showBrowser, {
    execute: args => {
      const path = (args.path as string) || '';
      const browserForPath = getBrowserForPath(path);

      // Check for browser not found
      if (!browserForPath) {
        return;
      }
      // Shortcut if we are using the main file browser
      if (browser === browserForPath) {
        app.shell.activateById(browser.id);
        return;
      } else {
        const areas: ApplicationShell.Area[] = ['left', 'right'];
        for (let area of areas) {
          const it = app.shell.widgets(area);
          let widget = it.next();
          while (widget) {
            if (widget.contains(browserForPath)) {
              app.shell.activateById(widget.id);
              return;
            }
            widget = it.next();
          }
        }
      }
    }
  });

  commands.addCommand(CommandIDs.shutdown, {
    execute: () => {
      const widget = tracker.currentWidget;

      if (widget) {
        return widget.shutdownKernels();
      }
    },
    iconClass: 'jp-MaterialIcon jp-StopIcon',
    label: 'Shutdown Kernel'
  });

  commands.addCommand(CommandIDs.toggleBrowser, {
    execute: () => {
      if (browser.isHidden) {
        return commands.execute(CommandIDs.showBrowser, void 0);
      }

      return commands.execute(CommandIDs.hideBrowser, void 0);
    }
  });

  commands.addCommand(CommandIDs.createLauncher, {
    label: 'New Launcher',
    execute: () => createLauncher(commands, browser)
  });
}

/**
 * Create a context menu for the file browser listing.
 *
 * #### Notes
 * This function generates temporary commands with an incremented name. These
 * commands are disposed when the menu itself is disposed.
 */
function createContextMenu(
  model: Contents.IModel | undefined,
  commands: CommandRegistry,
  registry: DocumentRegistry
): Menu {
  const menu = new Menu({ commands });

  // If the user did not click on any file, we still want to show
  // paste as a possibility.
  if (!model) {
    menu.addItem({ command: CommandIDs.paste });
    return menu;
  }

  menu.addItem({ command: CommandIDs.open });

  const path = model.path;
  if (model.type !== 'directory') {
    const factories = registry.preferredWidgetFactories(path).map(f => f.name);
    const notebookFactory = registry.getWidgetFactory('notebook').name;
    if (
      model.type === 'notebook' &&
      factories.indexOf(notebookFactory) === -1
    ) {
      factories.unshift(notebookFactory);
    }
    if (path && factories.length > 1) {
      const command = 'docmanager:open';
      const openWith = new Menu({ commands });
      openWith.title.label = 'Open With';
      factories.forEach(factory => {
        openWith.addItem({ args: { factory, path }, command });
      });
      menu.addItem({ type: 'submenu', submenu: openWith });
    }
    menu.addItem({ command: CommandIDs.openBrowserTab });
  }

  menu.addItem({ command: CommandIDs.rename });
  menu.addItem({ command: CommandIDs.del });
  menu.addItem({ command: CommandIDs.cut });

  if (model.type !== 'directory') {
    menu.addItem({ command: CommandIDs.copy });
  }

  menu.addItem({ command: CommandIDs.paste });

  if (model.type !== 'directory') {
    menu.addItem({ command: CommandIDs.duplicate });
    menu.addItem({ command: CommandIDs.download });
    menu.addItem({ command: CommandIDs.shutdown });
  }

  menu.addItem({ command: CommandIDs.share });
  menu.addItem({ command: CommandIDs.copyPath });
  menu.addItem({ command: CommandIDs.copyDownloadLink });

  return menu;
}

/**
 * Create a launcher for a given filebrowser widget.
 */
function createLauncher(
  commands: CommandRegistry,
  browser: FileBrowser
): Promise<MainAreaWidget<Launcher>> {
  const { model } = browser;

  return commands
    .execute('launcher:create', { cwd: model.path })
    .then((launcher: MainAreaWidget<Launcher>) => {
      model.pathChanged.connect(() => {
        launcher.content.cwd = model.path;
      }, launcher);
      return launcher;
    });
}
