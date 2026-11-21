targetScope = 'resourceGroup'
param location string = 'westeurope'
@secure()
param googleBooksApiKey string = ''
@secure()
param braveSearchApiKey string = ''
var suffix = uniqueString(resourceGroup().id)
var tags = { application: 'pince' }

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'pince${suffix}'
}
resource site 'Microsoft.Web/staticSites@2024-11-01' existing = {
  name: 'pince-${suffix}'
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'pince-cover-identity-${suffix}'
  location: location
}
// Functions owns its host blobs. Keep timer locks and deployment packages
// in a different account from private library data and account records.
resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'pinceworker${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: hostStorage
  name: 'default'
  properties: {}
}
resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'cover-worker-packages'
  properties: { publicAccess: 'None' }
}
resource queues 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}
resource jobs 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queues
  name: 'library-cover-jobs'
  properties: {}
}
var blobOwner = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var queueProcessor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8a0f0c08-91a1-4084-bc3d-661d67233fed')
resource hostRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: hostStorage
  name: guid(hostStorage.id, identity.id, blobOwner)
  properties: { roleDefinitionId: blobOwner, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource queueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: jobs
  name: guid(jobs.id, identity.id, queueProcessor)
  properties: { roleDefinitionId: queueProcessor, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'pince-cover-plan-${suffix}'
  location: location
  kind: 'functionapp'
  tags: tags
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}
resource worker 'Microsoft.Web/sites@2024-04-01' = {
  name: 'pince-covers-${suffix}'
  location: location
  kind: 'functionapp,linux'
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [hostRole, queueRole]
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      runtime: { name: 'node', version: '22' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${hostStorage.properties.primaryEndpoints.blob}${packages.name}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: identity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 512
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: hostStorage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: identity.properties.clientId }
        { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
        { name: 'COVER_QUEUE_URL', value: '${storage.properties.primaryEndpoints.queue}${jobs.name}' }
        { name: 'LIBRARY_API_ORIGIN', value: 'https://${site.properties.defaultHostname}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'GOOGLE_BOOKS_API_KEY', value: googleBooksApiKey }
        { name: 'BRAVE_SEARCH_API_KEY', value: braveSearchApiKey }
      ]
    }
  }
}
// The worker's own publishing passwords are switched off, for both the deployment endpoint and
// FTP. The deploy script uploads the package with the Azure sign-in instead.
resource noPasswordDeployment 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: worker
  name: 'scm'
  properties: { allow: false }
}
resource noPasswordFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: worker
  name: 'ftp'
  dependsOn: [noPasswordDeployment]
  properties: { allow: false }
}
output workerName string = worker.name
