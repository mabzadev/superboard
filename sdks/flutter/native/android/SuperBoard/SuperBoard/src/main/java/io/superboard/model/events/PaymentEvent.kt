package io.superboard.model.events

import android.os.Parcelable
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import io.superboard.model.EventType
import io.superboard.utils.InstantCompat
import kotlinx.parcelize.Parcelize

enum class PaymentEventType {
    @SerializedName("buy")
    BUY,
    @SerializedName("cancel")
    CANCEL,
    @SerializedName("refund")
    REFUND,
}

@Parcelize
class PaymentEvent(
    @SerializedName("event_type")
    val eventType: PaymentEventType? = null,
    @SerializedName("identifier")
    val appId: String? = null,
    @SerializedName("price_cents")
    val priceCents: Long? = null,
    val currency: String? = null,
    val date: InstantCompat? = null,
    @SerializedName("transaction_id")
    val transactionToken: String? = null,
    @SerializedName("original_transaction_id")
    val originalTransactionId: Int? = null,
    @SerializedName("product_id")
    val productId: String? = null,
    val store: Boolean = false,

    var link: String? = null,
) : Parcelable {

    companion object {
        private data class PurchaseJson(
            val orderId: String? = null,
            val packageName: String? = null,
            val productId: String? = null,
            val productIds: List<String>? = null,
            val purchaseTime: Long = 0L,
            val purchaseState: Int = 0,
            val purchaseToken: String? = null,
            val quantity: Int = 1,
            val autoRenewing: Boolean? = null,
            val acknowledged: Boolean = false,
            val obfuscatedAccountId: String? = null,
            val obfuscatedProfileId: String? = null,
            val developerPayload: String? = null
        )

        fun fromOriginalJson(
            originalJson: String,
            gson: Gson = Gson(),
            eventType: PaymentEventType = PaymentEventType.BUY,
            priceCents: Long? = null,
            currency: String? = null,
            productPrices: Map<String, Pair<Long?, String?>>? = null
        ): List<PaymentEvent> {
            return try {
                val purchaseJson = gson.fromJson(originalJson, PurchaseJson::class.java)

                val productIds = when {
                    !purchaseJson.productIds.isNullOrEmpty() -> purchaseJson.productIds
                    !purchaseJson.productId.isNullOrEmpty() -> listOf(purchaseJson.productId)
                    else -> emptyList()
                }

                if (productIds.isEmpty()) {
                    return emptyList()
                }

                val date = if (purchaseJson.purchaseTime > 0) {
                    InstantCompat.ofEpochMilli(purchaseJson.purchaseTime)
                } else null

                val transactionId = purchaseJson.orderId?.hashCode()

                productIds.map { productId ->
                    val (productPrice, productCurrency) = productPrices?.get(productId)
                        ?: (priceCents to currency)

                    PaymentEvent(
                        eventType = eventType,
                        appId = purchaseJson.packageName,
                        priceCents = productPrice,
                        currency = productCurrency,
                        date = date,
                        transactionToken = purchaseJson.purchaseToken,
                        productId = productId,
                        store = true,
                        link = null
                    )
                }
            } catch (e: Exception) {
                emptyList()
            }
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PaymentEvent) return false

        return eventType == other.eventType && transactionToken == other.transactionToken && date == other.date
    }

    override fun toString(): String {
        return "PaymentEvent(event=$eventType, appId=$appId, priceCents=$priceCents, " +
                "currency=$currency, date=$date, transactionId=$transactionToken, " +
                "originalTransactionId=$transactionToken, productId=$productId, store=$store)"
    }

}
