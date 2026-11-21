targetScope = 'resourceGroup'

@description('Region for Static Web Apps Free and the library storage account.')
param location string = 'westeurope'
@secure()
@minLength(10)
@maxLength(128)
param parentPassword string
@secure()
@minLength(10)
@maxLength(128)
param childPassword string
param parentUsername string = 'parinte'
param childUsername string = 'copil'
param enableVision bool = false
param visionLocation string = 'swedencentral'
param taxMultiplier string = '1.25'
param monthlyAzureReserve string = '0.60'

var suffix = uniqueString(resourceGroup().id)
var tags = { application: 'pince' }

resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: 'pince-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'pince${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource covers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'covers'
  properties: { publicAccess: 'None' }
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource library 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'LibraryData'
  properties: {}
}

// Global Standard bills tokens per request. No provisioned throughput or agent service.
resource vision 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (enableVision) {
  name: 'pince-vision-${suffix}'
  location: visionLocation
  kind: 'OpenAI'
  tags: tags
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: 'pince-vision-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

// Text detection places each scanned title in the shelf photo. The free tier allows 5,000 reads
// a month and cannot bill; a subscription can hold one free Vision account.
resource ocr 'Microsoft.CognitiveServices/accounts@2024-10-01' = if (enableVision) {
  name: 'pince-ocr-${suffix}'
  location: location
  kind: 'ComputerVision'
  tags: tags
  sku: { name: 'F0' }
  properties: {
    customSubDomainName: 'pince-ocr-${suffix}'
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = if (enableVision) {
  parent: vision
  name: 'pince-gpt-5-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-5-mini'
      version: '2025-08-07'
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

// The settings are a deployment of their own so that the keys are read only after the model
// deployment has finished; see site-settings.bicep.
module settings 'site-settings.bicep' = {
  name: 'pince-site-settings'
  params: {
    siteName: site.name
    storageName: storage.name
    visionName: enableVision ? vision!.name : ''
    ocrName: enableVision ? ocr!.name : ''
    modelName: enableVision ? model!.name : ''
    parentPassword: parentPassword
    childPassword: childPassword
    parentUsername: parentUsername
    childUsername: childUsername
    taxMultiplier: taxMultiplier
    monthlyAzureReserve: monthlyAzureReserve
  }
}

// Outputs are safe for regular deployment logs.
output siteName string = site.name
output hostname string = site.properties.defaultHostname
