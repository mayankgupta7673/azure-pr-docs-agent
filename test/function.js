// Azure Function: Order Processor
// Processes orders from Service Bus queue and stores in Cosmos DB

const { CosmosClient } = require("@azure/cosmos");
const { BlobServiceClient } = require("@azure/storage-blob");

module.exports = async function (context, orderMessage) {
    context.log('Processing order:', orderMessage.orderId);

    const startTime = Date.now();
    
    try {
        // Initialize Cosmos DB client
        const cosmosClient = new CosmosClient({
            endpoint: process.env.COSMOS_ENDPOINT,
            key: process.env.COSMOS_KEY
        });
        
        const database = cosmosClient.database("OrdersDB");
        const container = database.container("Orders");

        // Validate order data
        if (!orderMessage.orderId || !orderMessage.customerId) {
            throw new Error("Invalid order data: missing required fields");
        }

        // Enrich order with additional data
        const enrichedOrder = {
            ...orderMessage,
            processedAt: new Date().toISOString(),
            processingDuration: 0,
            status: "completed",
            processor: context.executionContext.functionName,
            invocationId: context.executionContext.invocationId
        };

        // Store in Cosmos DB with retry logic
        let retries = 3;
        let stored = false;
        
        while (retries > 0 && !stored) {
            try {
                await container.items.upsert(enrichedOrder);
                stored = true;
                context.log(`Order ${orderMessage.orderId} stored successfully`);
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                context.log(`Retry storing order, attempts left: ${retries}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Archive original message to blob storage
        const blobServiceClient = BlobServiceClient.fromConnectionString(
            process.env.STORAGE_CONNECTION_STRING
        );
        const containerClient = blobServiceClient.getContainerClient("order-archive");
        const blobName = `${orderMessage.orderId}-${Date.now()}.json`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        
        await blockBlobClient.upload(
            JSON.stringify(orderMessage, null, 2),
            JSON.stringify(orderMessage).length,
            {
                blobHTTPHeaders: {
                    blobContentType: "application/json"
                },
                metadata: {
                    orderId: orderMessage.orderId,
                    processedAt: new Date().toISOString()
                }
            }
        );

        // Calculate processing metrics
        const processingDuration = Date.now() - startTime;
        
        // Log metrics to Application Insights
        context.log.metric('OrderProcessingDuration', processingDuration, {
            orderId: orderMessage.orderId,
            customerId: orderMessage.customerId,
            amount: orderMessage.amount
        });

        context.bindings.outputEvent = {
            eventType: "OrderProcessed",
            subject: `orders/${orderMessage.orderId}`,
            data: {
                orderId: orderMessage.orderId,
                status: "completed",
                processingDuration: processingDuration
            }
        };

        context.log(`Order ${orderMessage.orderId} processed successfully in ${processingDuration}ms`);
        
        return {
            success: true,
            orderId: orderMessage.orderId,
            processingDuration: processingDuration
        };

    } catch (error) {
        context.log.error(`Error processing order ${orderMessage.orderId}:`, error);
        
        // Send to dead letter queue will be handled automatically by Service Bus
        // if maxDeliveryCount is exceeded
        
        throw error; // Re-throw to trigger retry policy
    }
};
