import type { MailModel } from "../../../common/mailFunctionality/MailModel.js"
import type { File as TutanotaFile, Mail, MailFolder } from "../../../common/api/entities/tutanota/TypeRefs.js"
import { createMail } from "../../../common/api/entities/tutanota/TypeRefs.js"
import { LockedError, PreconditionFailedError } from "../../../common/api/common/error/RestError"
import { Dialog } from "../../../common/gui/base/Dialog"
import { locator } from "../../../common/api/main/CommonLocator"
import { AllIcons } from "../../../common/gui/base/Icon"
import { Icons } from "../../../common/gui/base/icons/Icons"
import { isApp, isDesktop } from "../../../common/api/common/Env"
import { assertNotNull, neverNull, noOp, promiseMap } from "@tutao/tutanota-utils"
import { MailReportType, MailSetKind } from "../../../common/api/common/TutanotaConstants"
import { reportMailsAutomatically } from "./MailReportDialog"
import { DataFile } from "../../../common/api/common/DataFile"
import { lang, TranslationKey } from "../../../common/misc/LanguageViewModel"
import { FileController } from "../../../common/file/FileController"
import { DomRectReadOnlyPolyfilled, Dropdown, DropdownChildAttrs, PosRect } from "../../../common/gui/base/Dropdown.js"
import { modal } from "../../../common/gui/base/Modal.js"
import { ConversationViewModel } from "./ConversationViewModel.js"
import { size } from "../../../common/gui/size.js"
import { PinchZoom } from "../../../common/gui/PinchZoom.js"
import { InlineImageReference, InlineImages } from "../../../common/mailFunctionality/inlineImagesUtils.js"
import {
	assertSystemFolderOfType,
	getFolderIcon,
	getFolderName,
	getIndentedFolderNameForDropdown,
	getMoveTargetFolderSystems,
	isOfTypeOrSubfolderOf,
} from "../../../common/mailFunctionality/SharedMailUtils.js"
import { isSpamOrTrashFolder } from "../../../common/api/common/CommonMailUtils.js"
import { getElementId } from "../../../common/api/common/utils/EntityUtils.js"

export async function showDeleteConfirmationDialog(mails: ReadonlyArray<Mail>): Promise<boolean> {
	let trashMails: Mail[] = []
	let moveMails: Mail[] = []
	for (let mail of mails) {
		const folder = locator.mailModel.getMailFolderForMail(mail)
		const mailboxDetail = await locator.mailModel.getMailboxDetailsForMail(mail)
		if (mailboxDetail == null) {
			continue
		}
		const isFinalDelete = folder && isSpamOrTrashFolder(mailboxDetail.folders, folder)
		isFinalDelete ? trashMails.push(mail) : moveMails.push(mail)
	}

	let confirmationTextId: TranslationKey | null = null

	if (trashMails.length > 0) {
		if (moveMails.length > 0) {
			confirmationTextId = "finallyDeleteSelectedEmails_msg"
		} else {
			confirmationTextId = "finallyDeleteEmails_msg"
		}
	}

	if (confirmationTextId != null) {
		return Dialog.confirm(confirmationTextId, "ok_action")
	} else {
		return Promise.resolve(true)
	}
}

/**
 * @return whether emails were deleted
 */
export function promptAndDeleteMails(mailModel: MailModel, mails: ReadonlyArray<Mail>, onConfirm: () => void): Promise<boolean> {
	return showDeleteConfirmationDialog(mails).then((confirmed) => {
		if (confirmed) {
			onConfirm()
			return mailModel
				.deleteMails(mails)
				.then(() => true)
				.catch((e) => {
					//LockedError should no longer be thrown!?!
					if (e instanceof PreconditionFailedError || e instanceof LockedError) {
						return Dialog.message("operationStillActive_msg").then(() => false)
					} else {
						throw e
					}
				})
		} else {
			return Promise.resolve(false)
		}
	})
}

interface MoveMailsParams {
	mailModel: MailModel
	mails: ReadonlyArray<Mail>
	targetMailFolder: MailFolder
	isReportable?: boolean
}

/**
 * Moves the mails and reports them as spam if the user or settings allow it.
 * @return whether mails were actually moved
 */
export async function moveMails({ mailModel, mails, targetMailFolder, isReportable = true }: MoveMailsParams): Promise<boolean> {
	const details = await mailModel.getMailboxDetailsForMailFolder(targetMailFolder)
	if (details == null) {
		return false
	}
	const system = details.folders
	return mailModel
		.moveMails(mails, targetMailFolder)
		.then(async () => {
			if (isOfTypeOrSubfolderOf(system, targetMailFolder, MailSetKind.SPAM) && isReportable) {
				const reportableMails = mails.map((mail) => {
					// mails have just been moved
					const reportableMail = createMail(mail)
					reportableMail._id = targetMailFolder.isMailSet ? mail._id : [targetMailFolder.mails, getElementId(mail)]
					return reportableMail
				})
				const mailboxDetails = await mailModel.getMailboxDetailsForMailGroup(assertNotNull(targetMailFolder._ownerGroup))
				await reportMailsAutomatically(MailReportType.SPAM, mailModel, mailboxDetails, reportableMails)
			}

			return true
		})
		.catch((e) => {
			//LockedError should no longer be thrown!?!
			if (e instanceof LockedError || e instanceof PreconditionFailedError) {
				return Dialog.message("operationStillActive_msg").then(() => false)
			} else {
				throw e
			}
		})
}

export function archiveMails(mails: Mail[]): Promise<void> {
	if (mails.length > 0) {
		// assume all mails in the array belong to the same Mailbox
		return locator.mailModel.getMailboxFolders(mails[0]).then((folders) => {
			folders &&
				moveMails({
					mailModel: locator.mailModel,
					mails: mails,
					targetMailFolder: assertSystemFolderOfType(folders, MailSetKind.ARCHIVE),
				})
		})
	} else {
		return Promise.resolve()
	}
}

export function moveToInbox(mails: Mail[]): Promise<any> {
	if (mails.length > 0) {
		// assume all mails in the array belong to the same Mailbox
		return locator.mailModel.getMailboxFolders(mails[0]).then((folders) => {
			folders &&
				moveMails({
					mailModel: locator.mailModel,
					mails: mails,
					targetMailFolder: assertSystemFolderOfType(folders, MailSetKind.INBOX),
				})
		})
	} else {
		return Promise.resolve()
	}
}

export function getMailFolderIcon(mail: Mail): AllIcons {
	let folder = locator.mailModel.getMailFolderForMail(mail)

	if (folder) {
		return getFolderIcon(folder)
	} else {
		return Icons.Folder
	}
}

export function replaceCidsWithInlineImages(
	dom: HTMLElement,
	inlineImages: InlineImages,
	onContext: (cid: string, arg1: MouseEvent | TouchEvent, arg2: HTMLElement) => unknown,
): Array<HTMLElement> {
	// all image tags which have cid attribute. The cid attribute has been set by the sanitizer for adding a default image.
	const imageElements: Array<HTMLElement> = Array.from(dom.querySelectorAll("img[cid]"))
	if (dom.shadowRoot) {
		const shadowImageElements: Array<HTMLElement> = Array.from(dom.shadowRoot.querySelectorAll("img[cid]"))
		imageElements.push(...shadowImageElements)
	}
	const elementsWithCid: HTMLElement[] = []
	for (const imageElement of imageElements) {
		const cid = imageElement.getAttribute("cid")

		if (cid) {
			const inlineImage = inlineImages.get(cid)

			if (inlineImage) {
				elementsWithCid.push(imageElement)
				imageElement.setAttribute("src", inlineImage.objectUrl)
				imageElement.classList.remove("tutanota-placeholder")

				if (isApp()) {
					// Add long press action for apps
					let timeoutId: TimeoutID | null
					let startCoords:
						| {
								x: number
								y: number
						  }
						| null
						| undefined
					imageElement.addEventListener("touchstart", (e: TouchEvent) => {
						const touch = e.touches[0]
						if (!touch) return
						startCoords = {
							x: touch.clientX,
							y: touch.clientY,
						}
						timeoutId && clearTimeout(timeoutId)
						timeoutId = setTimeout(() => {
							onContext(inlineImage.cid, e, imageElement)
						}, 800)
					})
					imageElement.addEventListener("touchmove", (e: TouchEvent) => {
						const touch = e.touches[0]
						if (!touch || !startCoords || !timeoutId) return

						if (
							Math.abs(touch.clientX - startCoords.x) > PinchZoom.DRAG_THRESHOLD ||
							Math.abs(touch.clientY - startCoords.y) > PinchZoom.DRAG_THRESHOLD
						) {
							clearTimeout(timeoutId)
							timeoutId = null
						}
					})
					imageElement.addEventListener("touchend", () => {
						timeoutId && clearTimeout(timeoutId)
						timeoutId = null
					})
				}

				if (isDesktop()) {
					// add right click action for desktop apps
					imageElement.addEventListener("contextmenu", (e: MouseEvent) => {
						onContext(inlineImage.cid, e, imageElement)
						e.preventDefault()
					})
				}
			}
		}
	}
	return elementsWithCid
}

export function replaceInlineImagesWithCids(dom: HTMLElement): HTMLElement {
	const domClone = dom.cloneNode(true) as HTMLElement
	const inlineImages: Array<HTMLElement> = Array.from(domClone.querySelectorAll("img[cid]"))
	for (const inlineImage of inlineImages) {
		const cid = inlineImage.getAttribute("cid")
		inlineImage.setAttribute("src", "cid:" + (cid || ""))
		inlineImage.removeAttribute("cid")
	}
	return domClone
}

export function createInlineImage(file: DataFile): InlineImageReference {
	const cid = Math.random().toString(30).substring(2)
	file.cid = cid
	return createInlineImageReference(file, cid)
}

function createInlineImageReference(file: DataFile, cid: string): InlineImageReference {
	const blob = new Blob([file.data], {
		type: file.mimeType,
	})
	const objectUrl = URL.createObjectURL(blob)
	return {
		cid,
		objectUrl,
		blob,
	}
}

export async function loadInlineImages(fileController: FileController, attachments: Array<TutanotaFile>, referencedCids: Array<string>): Promise<InlineImages> {
	const filesToLoad = getReferencedAttachments(attachments, referencedCids)
	const inlineImages = new Map()
	return promiseMap(filesToLoad, async (file) => {
		let dataFile = await fileController.getAsDataFile(file)
		const { htmlSanitizer } = await import("../../../common/misc/HtmlSanitizer")
		dataFile = htmlSanitizer.sanitizeInlineAttachment(dataFile)
		const inlineImageReference = createInlineImageReference(dataFile, neverNull(file.cid))
		inlineImages.set(inlineImageReference.cid, inlineImageReference)
	}).then(() => inlineImages)
}

export function getReferencedAttachments(attachments: Array<TutanotaFile>, referencedCids: Array<string>): Array<TutanotaFile> {
	return attachments.filter((file) => referencedCids.find((rcid) => file.cid === rcid))
}

export async function showMoveMailsDropdown(
	model: MailModel,
	origin: PosRect,
	mails: readonly Mail[],
	opts?: { width?: number; withBackground?: boolean; onSelected?: () => unknown },
): Promise<void> {
	const { width = 300, withBackground = false, onSelected = noOp } = opts ?? {}
	const folders = await getMoveTargetFolderSystems(model, mails)
	if (folders.length === 0) return
	const folderButtons = folders.map(
		(f) =>
			({
				// We need to pass in the raw folder name to avoid including it in searches
				label: () => lang.get("folderDepth_label", { "{folderName}": getFolderName(f.folder), "{depth}": f.level }),
				text: () => getIndentedFolderNameForDropdown(f),
				click: () => {
					onSelected()
					moveMails({ mailModel: model, mails: mails, targetMailFolder: f.folder })
				},
				icon: getFolderIcon(f.folder),
			} satisfies DropdownChildAttrs),
	)

	const dropdown = new Dropdown(() => folderButtons, width)

	dropdown.setOrigin(new DomRectReadOnlyPolyfilled(origin.left, origin.top, origin.width, origin.height))
	modal.displayUnique(dropdown, withBackground)
}

export function getConversationTitle(conversationViewModel: ConversationViewModel): string {
	if (!conversationViewModel.isFinished()) {
		return lang.get("loading_msg")
	}
	const numberOfEmails = conversationViewModel.conversationItems().length
	if (numberOfEmails === 1) {
		return lang.get("oneEmail_label")
	} else {
		return lang.get("nbrOrEmails_label", { "{number}": numberOfEmails })
	}
}

export function getMoveMailBounds(): PosRect {
	// just putting the move mail dropdown in the left side of the viewport with a bit of margin
	return new DomRectReadOnlyPolyfilled(size.hpad_large, size.vpad_large, 0, 0)
}
