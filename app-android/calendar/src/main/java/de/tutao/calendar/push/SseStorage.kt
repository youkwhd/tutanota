package de.tutao.calendar.push

import androidx.annotation.WorkerThread
import androidx.lifecycle.LiveData
import de.tutao.calendar.AndroidKeyStoreFacade
import de.tutao.calendar.CryptoError
import de.tutao.calendar.alarms.AlarmNotificationEntity
import de.tutao.calendar.data.AppDatabase
import de.tutao.calendar.data.PushIdentifierKey
import de.tutao.calendar.data.User
import de.tutao.calendar.ipc.ExtendedNotificationMode
import java.security.KeyStoreException
import java.security.UnrecoverableEntryException
import java.util.Date

class SseStorage(
	private val db: AppDatabase,
	private val keyStoreFacade: AndroidKeyStoreFacade,
) {
	fun getPushIdentifier() = db.keyValueDao().getString(DEVICE_IDENTIFIER)

	fun storePushIdentifier(identifier: String, sseOrigin: String) {
		db.keyValueDao().putString(DEVICE_IDENTIFIER, identifier)
		db.keyValueDao().putString(SSE_ORIGIN, sseOrigin)
	}

	fun clear() {
		setLastMissedNotificationCheckTime(null)
		db.userInfoDao().clear()
		db.alarmInfoDao().clear()
	}

	@Throws(KeyStoreException::class, CryptoError::class)
	fun storePushIdentifierSessionKey(
		userId: String,
		pushIdentifierId: String,
		pushIdentifierSessionKey: ByteArray,
	) {
		// Provide right defaults for extended notification mode.
		//  - Start with "nothing" as a conservative default
		//  - If notifications were not used before, enable extended notifications
		val users = this.getUsers()
		if (!users.any { it.userId == userId }) {
			this.setExtendedNotificationConfig(userId, ExtendedNotificationMode.ONLY_SENDER)
		}
		val deviceEncSessionKey = keyStoreFacade.encryptKey(pushIdentifierSessionKey)
		db.userInfoDao().insertPushIdentifierKey(PushIdentifierKey(pushIdentifierId, deviceEncSessionKey))
		db.userInfoDao().insertUser(User(userId))
	}

	@Throws(UnrecoverableEntryException::class, KeyStoreException::class, CryptoError::class)
	fun getPushIdentifierSessionKey(pushIdentifierId: String): ByteArray? {
		val userInfo = db.userInfoDao().getPushIdentifierKey(pushIdentifierId) ?: return null
		return keyStoreFacade.decryptKey(userInfo.deviceEncPushIdentifierKey!!)
	}

	fun observeUsers(): LiveData<List<User>> {
		return db.userInfoDao().observeUsers()
	}

	fun readAlarmNotifications(): List<AlarmNotificationEntity> {
		return db.alarmInfoDao().alarmNotifications
	}

	fun insertAlarmNotification(alarmNotification: AlarmNotificationEntity) {
		db.alarmInfoDao().insertAlarmNotification(alarmNotification)
	}

	fun deleteAlarmNotification(alarmIdentifier: String) {
		db.alarmInfoDao().deleteAlarmNotification(alarmIdentifier)
	}

	@WorkerThread
	fun getLastProcessedNotificationId() = db.keyValueDao().getString(LAST_PROCESSED_NOTIFICATION_ID)

	@WorkerThread
	fun setLastProcessedNotificationId(id: String) = db.keyValueDao().putString(LAST_PROCESSED_NOTIFICATION_ID, id)

	@WorkerThread
	fun getLastMissedNotificationCheckTime(): Date? {
		val value = db.keyValueDao().getLong(LAST_MISSED_NOTIFICATION_CHECK_TIME)
		return if (value == 0L) {
			null
		} else Date(value)
	}

	@WorkerThread
	fun setLastMissedNotificationCheckTime(date: Date?) = db.keyValueDao().putLong(
		LAST_MISSED_NOTIFICATION_CHECK_TIME, date?.time ?: 0L
	)

	fun getSseOrigin() = db.keyValueDao().getString(SSE_ORIGIN)

	fun getConnectTimeoutInSeconds() = db.keyValueDao().getLong(CONNECT_TIMEOUT_SEC)

	fun setConnectTimeoutInSeconds(timeout: Long) = db.keyValueDao().putLong(CONNECT_TIMEOUT_SEC, timeout)

	fun removeUser(userId: String) {
		db.userInfoDao().deleteUser(userId)
	}

	fun setExtendedNotificationConfig(userId: String, mode: ExtendedNotificationMode) {
		db.keyValueDao().putString("$EXTENDED_NOTIFICATION_MODE:$userId", mode.value)
	}

	fun getExtendedNotificationConfig(userId: String): ExtendedNotificationMode {
		return db.keyValueDao().getString("$EXTENDED_NOTIFICATION_MODE:$userId")
			?.let { ExtendedNotificationMode.fromValue(it) }
			?: DEFAULT_EXTENDED_NOTIFCATION_MODE
	}

	fun getUsers(): List<User> = db.userInfoDao().users

	companion object {
		private const val LAST_PROCESSED_NOTIFICATION_ID = "lastProcessedNotificationId"
		private const val LAST_MISSED_NOTIFICATION_CHECK_TIME = "'lastMissedNotificationCheckTime'"
		private const val DEVICE_IDENTIFIER = "deviceIdentifier"
		private const val SSE_ORIGIN = "sseOrigin"
		private const val EXTENDED_NOTIFICATION_MODE = "extendedNotificationMode"
		private const val CONNECT_TIMEOUT_SEC = "connectTimeoutSec"
		private val DEFAULT_EXTENDED_NOTIFCATION_MODE = ExtendedNotificationMode.NO_SENDER_OR_SUBJECT
	}
}