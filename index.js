import Moralis from "moralis/node.js";
import fetch from "node-fetch";
import AWS from "aws-sdk";
import express from "express";
const dynamoDb = new AWS.DynamoDB.DocumentClient();
AWS.config.update({
    accessKeyId:"AKIA2F4FHJNUJ2UVX6HT",
    secretAccessKey:"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",
    region:'us-east-1'});
import {fetch_from_url,find_conversion_rate,covalent_logs,etherscan_logs,polygonscan_logs,value_from_hash,transaction_row} from './utils/variouslogs.js';
import {get_image_urls,get_inventory} from './utils/inventory_utils.js';
import {get_metrics_token_wise,get_metrics} from './utils/metric_utils.js';
//import { utils } from "@project-serum/anchor";
import {get_total_pages,put_txns,get_all_txns,get_page_txns,put_inventory,get_all_inventory,get_page_inventory,
        put_tokenwisemetrics,get_all_tokenwisemetrics,get_page_tokenwisemetrics,put_overall_metrics,get_overall_metrics} from "./utils/dynamodb_utils.js";

var wallet_processing_set={};

async function return_state(waddress,chain_name,txn_page=1,inventory_page=1,tokenwisemetric_page=1){
    var txn_ls=await get_page_txns(waddress,chain_name,txn_page);
    var inv_ls=await get_page_inventory(waddress,chain_name,inventory_page);
    var tokenwisemetric_ls=await get_page_tokenwisemetrics(waddress,chain_name,tokenwisemetric_page);
    var overall_metrics =await get_overall_metrics(waddress,chain_name);
    var obj={
        walletId :waddress,
        chainName : chain_name,
        overall_metrics: overall_metrics,
        transactions: txn_ls[0],
        total_txns_page: txn_ls[1],
        curr_txns_page:txn_ls[3],
        inventory: inv_ls[0],
        total_inventory_pages: inv_ls[1],
        curr_inventory_page: inv_ls[3],
        tokenwise_metrics: tokenwisemetric_ls[0],
        total_tokenwisemetric_pages: tokenwisemetric_ls[1],
        current_tokenwisemetric_page: tokenwisemetric_ls[3],
    }
    return obj;
}

async function return_NFT_transactions(userid,chain_name,waddress,txn_page=1,inventory_page=1,tokenwisemetric_page=1){
    var to_update=false;
    var curr_txn_list=[];
    var txns_skipped=0;
    var txns_processed=0;
    const newResult = await get_page_txns(waddress,chain_name,1);
    if(newResult[0]!=null){
        to_update=true;
        var ls=await get_all_txns(waddress,chain_name)
        curr_txn_list=curr_txn_list.concat(ls);
        console.log("exists in the table.");
        txns_processed=newResult[4];
        txns_skipped=newResult[5];
    }
    var transcations_list=[];
    const serverUrl = "https://kpvcez1i2tg3.usemoralis.com:2053/server";
    const appId = "viZCI1CZimCj22ZTyFuXudn3g0wUnG2pELzPvdg6";
    Moralis.start({ serverUrl, appId });
    var all_transfers=[];
    console.log("fetching...");
    var transfersNFT = await Moralis.Web3API.account.getNFTTransfers({ chain: chain_name, address: waddress, limit: 1});
    var total_nft_transfers_required=transfersNFT.total-(txns_processed+txns_skipped);

    console.log("Required total NFT transfers: ",total_nft_transfers_required);

    var n=0;
    while(all_transfers.length<total_nft_transfers_required){
        console.log("Here");
        transfersNFT = await Moralis.Web3API.account.getNFTTransfers({ chain: chain_name, address: waddress, offset: n*500});
        var cap=500;
        if(total_nft_transfers_required-all_transfers.length<cap){
            cap=total_nft_transfers_required-all_transfers.length;
        }
        all_transfers=all_transfers.concat(transfersNFT.result.slice(0,cap));
        console.log(all_transfers.length);
        n++;
    }
    //console.log(total_nft_transfers_required,all_transfers.length);
    //console.log(all_transfers[0]);
    console.log("For wallet address:",waddress," ,chain: ",chain_name,"total transactions:",all_transfers.length,"\nFollowing are the NFT Transaction values: ");
    let count=0;
    for(let i=0;i<all_transfers.length;i++){
        var txn_row=await transaction_row(all_transfers[i],waddress,chain_name,userid,txns_processed,txns_skipped,count);
        var this_transaction=txn_row[0];
        txns_processed=txn_row[1];
        txns_skipped=txn_row[2];
        count=txn_row[3];
        if(this_transaction!=null) transcations_list.push(this_transaction);
    }

    //update list by also adding existing txns from the table
    if(curr_txn_list.length!=0){
        transcations_list=transcations_list.concat(curr_txn_list);
    }
    await put_txns(waddress,chain_name,transcations_list,txns_processed,txns_skipped);
    const q={chain:chain_name,address: waddress};
    const inventory_NFTS=await Moralis.Web3API.account.getNFTs(q);
    console.log("NFTs in inventory using Moralis: ",inventory_NFTS.result.length);
    var metrics_;
    if(chain_name=="polygon"){
        metrics_=await get_metrics_token_wise(transcations_list,inventory_NFTS.result,null,true);
    }
    else{
        metrics_=await get_metrics_token_wise(transcations_list,inventory_NFTS.result);
    }
    var overall_metrics=metrics_[0];
    await put_overall_metrics(waddress,chain_name,overall_metrics);

    var token_wise_metrics=metrics_[1];
    await put_tokenwisemetrics(waddress,chain_name,token_wise_metrics);

    var inventory_things=metrics_[2];
    await put_inventory(waddress,chain_name,inventory_things);

    try{
        var body= await return_state(waddress,chain_name,txn_page,inventory_page,tokenwisemetric_page);
        return {
            statusCode: 200,
            status: "Success",
            body: body,
        };
    }
    catch(e){
        console.log("Error is found....");
        console.log(e);
        return {
            statusCode: 500,
            status: "ERROR",
            body: JSON.stringify({ error: e.message }),
        };
    }
}

async function ToProcessWallet(wallet,chain_name){
    var temp=chain_name.concat(wallet);
    if(wallet_processing_set[temp]!=null){
        return false;
    }
    else{
        wallet_processing_set[temp]=1;
        return true;
    }
}

async function hello(event, context){
    var wallet = event["queryStringParameters"]['wallet'];
    if(wallet==null){
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "No wallet provided." }),
        };
    }
    let userId = event["queryStringParameters"]['userid'];
    if(userId==null){
        userId="1";
    }
    let chain_name= event["queryStringParameters"]['chain'];
    if(chain_name==null){
        chain_name="eth";
    }
    let txn_page=event["queryStringParameters"]['txn_page'];
    if(txn_page==null){
        txn_page=1;
    }
    else{
        txn_page=parseInt(txn_page);
    }
    let inventory_page=event["queryStringParameters"]['inventory_page'];
    if(inventory_page==null){
        inventory_page=1;
    }
    else{
        inventory_page=parseInt(inventory_page);
    }
    let token_page=event["queryStringParameters"]['token_page'];
    if(token_page==null){
        token_page=1;
    }
    else{
        token_page=parseInt(token_page);
    }
    var to_process=await ToProcessWallet(wallet,chain_name);
    if(to_process==true){
        try{
            await return_NFT_transactions(userId,chain_name,wallet,txn_page,inventory_page,token_page);
        }
        finally{
            var temp=chain_name.concat(wallet);
            delete wallet_processing_set[temp];
        }
    }
};

var params=function(req){
    let q=req.url.split('?'),result={};
    if(q.length>=2){
        q[1].split('&').forEach((item)=>{
             try {
               result[item.split('=')[0]]=item.split('=')[1];
             } catch (e) {
               result[item.split('=')[0]]='';
             }
        })
    }
    return result;
}

const app = express();
const port = 3000;


//app.get('/', async(req, res) => {
app.get('/', (req, res) => {
    req.params=params(req);
    console.log(req.params);
    const jsonData= {
        "queryStringParameters":{
            "wallet":req.params.wallet,
            "userid":req.params.userid,
            "chain":req.params.chain,
            "txn_page": req.params.txn_page,
            "inventory_page": req.params.inventory_page,
            "token_page": req.params.token_page,
        }
    };
    //const response=await hello(jsonData,'');
    //res.send(response);
    hello(jsonData,'');
    var response= {
        statusCode: 200,
        body:"Wallet is getting updated",
    };
    res.send(response);
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})

