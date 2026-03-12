import ExtensionAPI from "sap/fe/core/ExtensionAPI";
import Context from "sap/ui/model/odata/v4/Context";
import EditFlow from "sap/fe/core/controllerextensions/EditFlow";
import BaseController from "sap/fe/core/BaseController";
import Component from "cc/spreadsheetimporter/v1_7_4/Component";

/**
 * Generated event handler.
 *
 * @param this reference to the 'this' that the event handler is bound to.
 * @param context the context of the page on which the event was fired. `undefined` for list report page.
 * @param selectedContexts the selected contexts of the table rows.
 */
export async function onUpload(
  this: ExtensionAPI & { editFlow: EditFlow },
  context: Context | undefined,
  selectedContexts: Context[],
) {
  const view = this.getEditFlow().getView();
  const controller = this.getEditFlow()
    .getView()
    .getController() as BaseController;
  view.setBusyIndicatorDelay(0);
  view.setBusy(true);
  const spreadsheetUpload = (await controller
    .getAppComponent()
    .createComponent({
      usage: "spreadsheetImporter",
      async: true,
      componentData: {
        context: this,
        tableId:
          "demo.manageauthors::AuthorsList--fe::table::Authors::LineItem-innerTable",
        columns: ["firstName", "lastName"],
        createActiveEntity: true,
        hideSampleData: true,
        strict: true,
        fieldMatchType: "label",
      },
    })) as unknown as Component;
  spreadsheetUpload.openSpreadsheetUploadDialog();
  view.setBusy(false);
}
