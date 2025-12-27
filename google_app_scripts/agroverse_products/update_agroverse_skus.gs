/**
 * File: google_app_scripts/agroverse_products/update_agroverse_skus.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Updates the "Agroverse SKUs" Google Sheet with product information from agroverse.shop
 */

const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const SHEET_NAME = 'Agroverse SKUs';

/**
 * Product data from agroverse.shop/js/products.js
 */
const PRODUCTS_DATA = {
  'ceremonial-cacao-paulo-s-la-do-sitio-farm-200g': {
    productId: 'ceremonial-cacao-paulo-s-la-do-sitio-farm-200g',
    name: 'Ceremonial Cacao – La do Sitio Farm, Pará Brazil, 2024 (200g)',
    price: 25.00,
    weight: 7.05,
    image: '/assets/images/products/la-do-sitio-farm.jpg',
    category: 'retail',
    shipment: 'AGL8',
    farm: "Paulo's Farm, Pará"
  },
  'taste-of-rainforest-caramelized-cacao-beans': {
    productId: 'taste-of-rainforest-caramelized-cacao-beans',
    name: 'Taste of Rainforest - 200 grams Caramelized Cacao Beans',
    price: 25.00,
    weight: 7.05,
    image: '/assets/images/products/taste-of-rainforest.jpeg',
    category: 'retail',
    shipment: 'AGL10',
    farm: 'Capela Velha Fazenda'
  },
  'oscar-bahia-ceremonial-cacao-200g': {
    productId: 'oscar-bahia-ceremonial-cacao-200g',
    name: "Ceremonial Cacao – Oscar's Farm, Bahia Brazil, 2024 (200g)",
    price: 25.00,
    weight: 7.05,
    image: '/assets/images/products/oscars-farm.jpeg',
    category: 'retail',
    shipment: 'AGL4',
    farm: "Oscar's Farm, Bahia"
  },
  '8-ounce-organic-cacao-nibs': {
    productId: '8-ounce-organic-cacao-nibs',
    name: 'Amazon Rainforest Regenerative 8 Ounce Organic Cacao Nibs',
    price: 25.00,
    weight: 8.0,
    image: '/assets/images/products/cacao-nibs.jpeg',
    category: 'retail',
    shipment: 'AGL4',
    farm: "Oscar's Farm, Bahia"
  },
  'organic-criollo-cacao-beans-oscar-farm': {
    productId: 'organic-criollo-cacao-beans-oscar-farm',
    name: 'Organic Criollo Cacao Beans - Oscar\'s 100-Year Farm (per kg)',
    price: 0,
    image: '/assets/images/products/oscars-farm.jpeg',
    category: 'wholesale',
    shipment: 'AGL14',
    farm: "Oscar's Farm, Bahia"
  },
  'organic-hybrid-cacao-beans-jesus-da-deus': {
    productId: 'organic-hybrid-cacao-beans-jesus-da-deus',
    name: 'Organic Hybrid Cacao Beans - Jesus Da Deus Fazenda (per kg)',
    price: 0,
    image: '/assets/images/products/taste-of-rainforest.jpeg',
    category: 'wholesale',
    shipment: 'AGL13',
    farm: "Vivi's Jesus Do Deus Farm, Itacaré"
  },
  'organic-criollo-cacao-nibs-oscar-farm': {
    productId: 'organic-criollo-cacao-nibs-oscar-farm',
    name: 'Organic Criollo Cacao Nibs - Oscar\'s 100-Year Farm (per kg)',
    price: 0,
    image: '/assets/images/products/cacao-nibs.jpeg',
    category: 'wholesale',
    shipment: 'AGL4',
    farm: "Oscar's Farm, Bahia"
  },
  'premium-organic-cacao-beans-la-do-sitio': {
    productId: 'premium-organic-cacao-beans-la-do-sitio',
    name: 'Premium Organic Cacao Beans - La do Sitio Farm (per kg)',
    price: 0,
    image: '/assets/images/products/la-do-sitio-farm.jpg',
    category: 'wholesale',
    shipment: 'AGL8',
    farm: "Paulo's Farm, Pará"
  }
};

/**
 * Updates the Agroverse SKUs sheet with product information
 */
function updateAgroverseSKUs() {
  try {
    Logger.log('Starting to update Agroverse SKUs sheet...');
    
    // Open the spreadsheet and sheet
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      Logger.log(`Created new sheet: ${SHEET_NAME}`);
    }
    
    // Clear existing content
    sheet.clear();
    
    // Define headers
    const headers = [
      'Product ID',
      'Product Name',
      'Price (USD)',
      'Weight (oz)',
      'Category',
      'Shipment',
      'Farm',
      'Image Path'
    ];
    
    // Add headers to row 1
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    
    // Prepare data rows
    const dataRows = [];
    const productIds = Object.keys(PRODUCTS_DATA);
    
    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i];
      const product = PRODUCTS_DATA[productId];
      
      // Build full image URL
      const imageUrl = product.image.startsWith('http') 
        ? product.image 
        : `https://www.agroverse.shop${product.image}`;
      
      const row = [
        product.productId || productId,
        product.name || '',
        product.price || 0,
        product.weight || '',
        product.category || '',
        product.shipment || '',
        product.farm || '',
        imageUrl
      ];
      
      dataRows.push(row);
    }
    
    // Add data rows starting from row 2
    if (dataRows.length > 0) {
      sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
      
      // Format price column as currency
      const priceColumn = 3; // Column C
      sheet.getRange(2, priceColumn, dataRows.length, 1).setNumberFormat('$#,##0.00');
      
      // Auto-resize columns
      sheet.autoResizeColumns(1, headers.length);
      
      Logger.log(`Successfully updated ${dataRows.length} products to Agroverse SKUs sheet`);
    } else {
      Logger.log('No products to add');
    }
    
    return {
      success: true,
      message: `Updated ${dataRows.length} products`,
      productsCount: dataRows.length
    };
    
  } catch (e) {
    Logger.log(`Error updating Agroverse SKUs: ${e.message}`);
    Logger.log(`Stack trace: ${e.stack}`);
    return {
      success: false,
      error: e.message
    };
  }
}

