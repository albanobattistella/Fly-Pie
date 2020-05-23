//////////////////////////////////////////////////////////////////////////////////////////
//                                                                                      //
//    _____                    ___  _     ___       This software may be modified       //
//   / ___/__  ___  __ _  ___ / _ \(_)__ |_  |      and distributed under the           //
//  / (_ / _ \/ _ \/  ' \/ -_) ___/ / -_) __/       terms of the MIT license. See       //
//  \___/_//_/\___/_/_/_/\__/_/  /_/\__/____/       the LICENSE file for details.       //
//                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const Gtk            = imports.gi.Gtk;
const ExtensionUtils = imports.misc.extensionUtils;
const Main           = imports.ui.main;
const Gio            = imports.gi.Gio;
const Shell          = imports.gi.Shell;
const GLib           = imports.gi.GLib;
const GMenu          = imports.gi.GMenu;

const Me = ExtensionUtils.getCurrentExtension();

const debug = Me.imports.common.debug.debug;

//////////////////////////////////////////////////////////////////////////////////////////
// Parts of this code is based on the Gno-Menu extension by Panacier                    //
// (https://github.com/The-Panacea-Projects/Gnomenu)                                    //
//////////////////////////////////////////////////////////////////////////////////////////

var FileInfo = class FileInfo {

  constructor(file) { this._file = file; }

  openDefault() {
    let launchContext = global.create_app_launch_context(0, -1);
    // launchContext.set_timestamp(timestamp);

    try {
      Gio.AppInfo.launch_default_for_uri(this._file.get_uri(), launchContext);
    } catch (e) {
      Main.notifyError("Failed to open \"%s\"".format(this.name), e.message);
    }
  }

  getIcon() {
    try {
      let info = this._file.query_info("standard::icon", 0, null);
      return info.get_icon().to_string();
    } catch (e) { return 'missing-image'; }
  }

  getName() {
    try {
      let info = this._file.query_info('standard::display-name', 0, null);
      return info.get_display_name();
    } catch (e) { return this._file.get_basename(); }
  }
};

//////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////

var MenuFactory = class MenuFactory {

  // -------------------------------------------------------------------- public interface

  static getUserDirectoriesItems() {
    let result = {name : "Places", icon : "system-file-manager", items : []};

    this._pushFileInfo(result, new FileInfo(Gio.File.new_for_path(GLib.get_home_dir())));

    const DEFAULT_DIRECTORIES = [
      GLib.UserDirectory.DIRECTORY_DESKTOP,
      GLib.UserDirectory.DIRECTORY_DOCUMENTS,
      GLib.UserDirectory.DIRECTORY_DOWNLOAD,
      GLib.UserDirectory.DIRECTORY_MUSIC,
      GLib.UserDirectory.DIRECTORY_PICTURES,
      GLib.UserDirectory.DIRECTORY_TEMPLATES,
      GLib.UserDirectory.DIRECTORY_PUBLIC_SHARE,
      GLib.UserDirectory.DIRECTORY_VIDEOS
    ];

    for (let i = 0; i < DEFAULT_DIRECTORIES.length; ++i) {
      let path = GLib.get_user_special_dir(DEFAULT_DIRECTORIES[i]);
      this._pushFileInfo(result, new FileInfo(Gio.File.new_for_path(path)));
    }

    return result;
  }

  static getRecentItems() {
    let recentFiles = Gtk.RecentManager.get_default().get_items();
    let result      = {name : "Recent", icon : "document-open-recent", items : []};

    recentFiles.forEach(recentFile => {
      if (recentFile.exists()) {
        result.items.push({
          name : recentFile.get_display_name(),
          icon : recentFile.get_gicon().to_string(),
          activate : () => this._openUri(recentFile.get_uri())
        });
      }
    });

    return result;
  }

  static getFavoriteItems() {
    let apps   = global.settings.get_strv('favorite-apps');
    let result = {name : "Favorites", icon : "emblem-favorite", items : []};

    for (let i = 0; i < apps.length; ++i) {
      let app = Shell.AppSystem.get_default().lookup_app(apps[i]);
      this._pushShellApp(result, app);
    }

    return result;
  }

  static getFrequentItems() {
    let apps   = Shell.AppUsage.get_default().get_most_used();
    let result = {name : "Frequently Used", icon : "emblem-default", items : []};

    for (let i = 0; i < apps.length; ++i) {
      this._pushShellApp(result, apps[i]);
    }

    return result;
  }

  static getRunningAppsItems() {
    let apps   = Shell.AppSystem.get_default().get_running();
    let result = {name : "Running Apps", icon : "preferences-system-windows", items : []};

    for (let i = 0; i < apps.length; ++i) {
      let windows = apps[i].get_windows();
      let icon    = apps[i].get_app_info().get_icon().to_string();
      windows.forEach(window => {
        result.items.push({
          name : window.get_title(),
          icon : icon,
          activate : () => window.activate(0 /*timestamp*/)
        });
      });
    }

    return result;
  }

  static getAppMenuItems() {
    let menu =
      new GMenu.Tree({menu_basename : 'applications.menu', flags : GMenu.TreeFlags.NONE});

    menu.load_sync();

    let result = {name : "Applications", icon : "applications-system", items : []};

    this._pushMenuItems(result, menu.get_root_directory());

    return result;
  }

  // ----------------------------------------------------------------------- private stuff

  static _pushMenuItems(menu, dir) {
    let iter = dir.iter(), nodeType, item;

    while ((nodeType = iter.next()) !== GMenu.TreeItemType.INVALID) {
      switch (nodeType) {
      case GMenu.TreeItemType.ENTRY:
        let app  = iter.get_entry().get_app_info();
        let icon = "foo";
        if (app.get_icon()) { icon = app.get_icon().to_string(); }
        item = {
          name : app.get_name(),
          icon : icon,
          activate : () => this._launchApp(app)
        };
        menu.items.push(item);
        break;
      case GMenu.TreeItemType.DIRECTORY:
        let directory = iter.get_directory();
        item          = {
          name : directory.get_name(),
          icon : directory.get_icon().to_string(),
          items : []
        };

        this._pushMenuItems(item, directory);

        menu.items.push(item);

        break;
      default: // SEPARATOR, HEADER, ALIAS. skip for now.
        break;
      }
    }
  }

  static _pushShellApp(menu, app) {
    if (app && app.get_app_info().should_show()) {
      menu.items.push({
        name : app.get_name(),
        icon : app.get_app_info().get_icon().to_string(),
        activate : () => app.open_new_window(-1)
      });
    }
  }

  static _pushFileInfo(menu, file) {
    menu.items.push({
      name : file.getName(),
      icon : file.getIcon(),
      activate : () => file.openDefault()
    });
  }

  // Uses the system's default application for opening the given URI.
  static _openUri(uri) {
    let ctx = global.create_app_launch_context(0, -1);

    try {
      Gio.AppInfo.launch_default_for_uri(uri, ctx);
    } catch (e) { Main.notifyError("Failed to open URI!", e.message); }
  }

  // Launches the application described by the given Gio.AppInfo object.
  static _launchApp(app) {
    let ctx = global.create_app_launch_context(0, -1);

    try {
      app.launch([], ctx);
    } catch (e) { Main.notifyError("Failed to launch app!", e.message); }
  }
};
