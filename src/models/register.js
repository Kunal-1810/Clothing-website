const mongoose = require('mongoose')
const registerSchema= new mongoose.Schema({

fullName:{
type:String,
},
username:{
type:String,
},
email:{
type:String,
},
password:{
type:String,
},
date:{
type:Date,
default:Date.now
}
})


const Register = new mongoose.model('Register',registerSchema)
module.exports=Register;

